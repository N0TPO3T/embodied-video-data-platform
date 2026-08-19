import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

import {
  ScarcityConfigEntity,
  type ScarcityTier,
} from "../database/entities/scarcity-config.entity.js";
import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";

export type InventorySnapshotResult = {
  snapshot_id: string;
  mode: "cold_start" | "live_snapshot";
  authoritative_coefficient: number;
  c_scene: number;
  c_standard_task: number;
  c_variant: number;
  current_video_excluded: boolean;
  scene_inventory_count: number | null;
  task_inventory_count: number | null;
  variant_inventory_count: number | null;
  scene_name: string | null;
  task_name: string | null;
  variant_name: string | null;
};

const INVENTORY_LOCK_EXCLUDED_STATUSES = ["quarantined", "delete_pending", "deleted"];

@Injectable()
export class InventoryService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(MediaMetadataEntity)
    private readonly metadata: Repository<MediaMetadataEntity>,
  ) {}

  /**
   * 查询某个提交的媒体元数据（含 AI 识别的场景分类）。
   * 若尚未生成媒体元数据（如仍在上传阶段），返回 null。
   */
  async findMetadata(
    submissionId: string,
  ): Promise<MediaMetadataEntity | null> {
    return this.metadata.findOne({ where: { submissionId } });
  }

  async countForClassification(
    sceneId: string | null,
    taskId: string | null,
    variantId: string | null,
    excludeSubmissionId: string,
  ): Promise<{
    scene: number;
    task: number;
    variant: number;
  }> {
    if (!sceneId) {
      return { scene: 0, task: 0, variant: 0 };
    }
    const manager = this.dataSource.manager;
    const excluded = INVENTORY_LOCK_EXCLUDED_STATUSES;

    const scene = await manager
      .createQueryBuilder(MediaMetadataEntity, "m")
      .innerJoin("m.submission", "s")
      .where("m.scene_id = :sceneId", { sceneId })
      .andWhere("s.id <> :excludeSubmissionId", { excludeSubmissionId })
      .andWhere("s.processing_status IN (:...processing)", {
        processing: ["completed", "ai_processing", "awaiting_ai", "queued"],
      })
      .andWhere("s.asset_status NOT IN (:...excluded)", { excluded })
      .andWhere("s.storage_status = 'available'")
      .getCount();

    if (!taskId) {
      return { scene, task: scene, variant: scene };
    }
    const task = await manager
      .createQueryBuilder(MediaMetadataEntity, "m")
      .innerJoin("m.submission", "s")
      .where("m.scene_id = :sceneId", { sceneId })
      .andWhere("m.task_id = :taskId", { taskId })
      .andWhere("s.id <> :excludeSubmissionId", { excludeSubmissionId })
      .andWhere("s.processing_status IN (:...processing)", {
        processing: ["completed", "ai_processing", "awaiting_ai", "queued"],
      })
      .andWhere("s.asset_status NOT IN (:...excluded)", { excluded })
      .andWhere("s.storage_status = 'available'")
      .getCount();

    if (!variantId) {
      return { scene, task, variant: task };
    }
    const variant = await manager
      .createQueryBuilder(MediaMetadataEntity, "m")
      .innerJoin("m.submission", "s")
      .where("m.scene_id = :sceneId", { sceneId })
      .andWhere("m.task_id = :taskId", { taskId })
      .andWhere("m.variant_id = :variantId", { variantId })
      .andWhere("s.id <> :excludeSubmissionId", { excludeSubmissionId })
      .andWhere("s.processing_status IN (:...processing)", {
        processing: ["completed", "ai_processing", "awaiting_ai", "queued"],
      })
      .andWhere("s.asset_status NOT IN (:...excluded)", { excluded })
      .andWhere("s.storage_status = 'available'")
      .getCount();

    return { scene, task, variant };
  }

  /**
   * 按档位把存量映射为奖励系数（存量越少系数越高）。
   */
  coefficientForCount(count: number, tiers: ScarcityTier[]): number {
    if (count <= 0) return 1;
    const matched = tiers.find(
      (tier) => count >= tier.minCount && (tier.maxCount === null || count <= tier.maxCount),
    );
    return matched?.coefficient ?? 1;
  }

  /**
   * 构建注入 AI 质检输入的库存上下文。
   * - 视频尚未被识别场景（scene_id 为空）时返回 cold_start，系数恒为 1（不惩罚也不奖励）。
   * - 有场景分类时按稀缺档位计算 C_scene/C_standard_task/C_variant，并按权重加权。
   */
  async buildInventoryContext(
    submissionId: string,
    config: ScarcityConfigEntity | null,
  ): Promise<InventorySnapshotResult> {
    const metadata = await this.findMetadata(submissionId);
    const sceneId = metadata?.sceneId ?? null;
    const taskId = metadata?.taskId ?? null;
    const variantId = metadata?.variantId ?? null;

    if (!sceneId || !config?.enabled) {
      return {
        snapshot_id: "quality-lab-cold-start",
        mode: "cold_start",
        authoritative_coefficient: 1,
        c_scene: 1,
        c_standard_task: 1,
        c_variant: 1,
        current_video_excluded: true,
        scene_inventory_count: null,
        task_inventory_count: null,
        variant_inventory_count: null,
        scene_name: null,
        task_name: null,
        variant_name: null,
      };
    }

    const counts = await this.countForClassification(
      sceneId,
      taskId,
      variantId,
      submissionId,
    );
    const tiers = config.tiers;
    const cScene = this.coefficientForCount(counts.scene, tiers);
    const cTask = this.coefficientForCount(counts.task, tiers);
    const cVariant = this.coefficientForCount(counts.variant, tiers);
    const weights = config.weights;
    const authoritative = Math.min(
      1,
      Math.max(
        0,
        weights.scene * cScene +
          weights.standardTask * cTask +
          weights.variant * cVariant,
      ),
    );

    return {
      snapshot_id: `inventory-${Date.now()}`,
      mode: "live_snapshot",
      authoritative_coefficient: authoritative,
      c_scene: cScene,
      c_standard_task: cTask,
      c_variant: cVariant,
      current_video_excluded: true,
      scene_inventory_count: counts.scene,
      task_inventory_count: counts.task,
      variant_inventory_count: counts.variant,
      scene_name: sceneId,
      task_name: taskId,
      variant_name: variantId,
    };
  }
}
