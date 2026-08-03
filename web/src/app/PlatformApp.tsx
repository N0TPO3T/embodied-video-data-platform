"use client";

import { useState } from "react";
import { useDemoStore } from "../data/DemoStoreContext";
import type { Role } from "../domain/types";
import { LoginPage } from "../features/auth/LoginPage";
import { AdminDashboard } from "../features/admin/AdminDashboard";
import { AiQueuePage } from "../features/admin/AiQueuePage";
import { AssetsPage } from "../features/admin/AssetsPage";
import { AuditLogPage } from "../features/admin/AuditLogPage";
import { PublicConfigPage } from "../features/admin/PublicConfigPage";
import { QualityReviewPage } from "../features/admin/QualityReviewPage";
import { RulesPage } from "../features/admin/RulesPage";
import { SettlementPage } from "../features/admin/SettlementPage";
import { SubmissionsAdminPage } from "../features/admin/SubmissionsAdminPage";
import { UsersTeamsPage } from "../features/admin/UsersTeamsPage";
import { WithdrawalsPage } from "../features/admin/WithdrawalsPage";
import { CollectorDashboard } from "../features/collector/CollectorDashboard";
import { EarningsPage } from "../features/collector/EarningsPage";
import { GuidePage } from "../features/collector/GuidePage";
import { ProfilePage } from "../features/collector/ProfilePage";
import { SubmissionDetail } from "../features/collector/SubmissionDetail";
import { SubmissionsPage } from "../features/collector/SubmissionsPage";
import { UploadPage } from "../features/collector/UploadPage";
import { PublicHomePage } from "../features/public/PublicHomePage";
import { TeamDashboard } from "../features/team/TeamDashboard";
import { MembersPage } from "../features/team/MembersPage";
import { ReviewPage } from "../features/team/ReviewPage";
import { TeamAnalyticsPage } from "../features/team/TeamAnalyticsPage";
import { TeamIncomePage } from "../features/team/TeamIncomePage";
import { TeamSubmissionsPage } from "../features/team/TeamSubmissionsPage";
import { DashboardShell } from "../layout/DashboardShell";
import { InteractionProvider } from "../interactions/InteractionContext";
import { roleHome } from "./navigation";

function requiredRole(path: string): Role | null {
  if (path.startsWith("/collector")) return "collector";
  if (path.startsWith("/team")) return "leader";
  if (path.startsWith("/admin")) return "admin";
  return null;
}

export function PlatformApp({ initialPath }: { initialPath: string }) {
  return (
    <InteractionProvider>
      <PlatformContent initialPath={initialPath} />
    </InteractionProvider>
  );
}

function PlatformContent({ initialPath }: { initialPath: string }) {
  const [path, setPath] = useState(initialPath || "/");
  const { currentUser, loginAs } = useDemoStore();

  function navigate(nextPath: string) {
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  }

  function enter(role: Role) {
    loginAs(role);
    navigate(roleHome[role]);
  }

  if (path === "/") return <PublicHomePage navigate={navigate} />;
  if (path === "/login") return <LoginPage onEnter={enter} navigate={navigate} />;

  const gatedRole = requiredRole(path);
  const safePath = gatedRole && gatedRole !== currentUser.role ? roleHome[currentUser.role] : path;

  let page = <CollectorDashboard navigate={navigate} />;
  if (safePath === "/collector" && initialPath.startsWith("/admin")) {
    page = <CollectorDashboard navigate={navigate} title />;
  } else if (currentUser.role === "collector") {
    if (safePath === "/collector/upload") page = <UploadPage />;
    else if (safePath === "/collector/submissions") page = <SubmissionsPage navigate={navigate} />;
    else if (safePath.startsWith("/collector/submissions/")) page = <SubmissionDetail id={safePath.split("/").at(-1) ?? ""} navigate={navigate} />;
    else if (safePath === "/collector/quality") page = <SubmissionsPage qualityOnly navigate={navigate} />;
    else if (safePath === "/collector/earnings") page = <EarningsPage />;
    else if (safePath === "/collector/guide") page = <GuidePage />;
    else if (safePath === "/collector/profile") page = <ProfilePage />;
  } else if (currentUser.role === "leader") {
    if (safePath === "/team/members") page = <MembersPage />;
    else if (safePath === "/team/submissions") page = <TeamSubmissionsPage />;
    else if (safePath === "/team/review") page = <ReviewPage />;
    else if (safePath === "/team/analytics") page = <TeamAnalyticsPage />;
    else if (safePath === "/team/income") page = <TeamIncomePage />;
    else page = <TeamDashboard />;
  } else if (currentUser.role === "admin") {
    if (safePath === "/admin/submissions") page = <SubmissionsAdminPage />;
    else if (safePath === "/admin/ai") page = <AiQueuePage />;
    else if (safePath === "/admin/review") page = <QualityReviewPage />;
    else if (safePath === "/admin/assets") page = <AssetsPage />;
    else if (safePath === "/admin/people") page = <UsersTeamsPage />;
    else if (safePath === "/admin/rules") page = <RulesPage />;
    else if (safePath === "/admin/settlements") page = <SettlementPage />;
    else if (safePath === "/admin/withdrawals") page = <WithdrawalsPage />;
    else if (safePath === "/admin/public") page = <PublicConfigPage />;
    else if (safePath === "/admin/audit") page = <AuditLogPage />;
    else page = <AdminDashboard />;
  }

  return (
    <DashboardShell currentPath={safePath} navigate={navigate}>
      {page}
    </DashboardShell>
  );
}
