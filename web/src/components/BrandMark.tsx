import { Boxes } from "lucide-react";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-mark" aria-label="Embodied Data">
      <span className="brand-icon">
        <Boxes size={21} strokeWidth={2.2} />
      </span>
      {!compact && (
        <span className="brand-copy">
          <strong>Embodied Data</strong>
          <small>具身视频数据平台</small>
        </span>
      )}
    </div>
  );
}
