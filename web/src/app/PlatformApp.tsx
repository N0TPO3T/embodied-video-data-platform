"use client";

import { useState } from "react";
import { useDemoStore } from "../data/DemoStoreContext";
import type { Role } from "../domain/types";
import { LoginPage } from "../features/auth/LoginPage";
import { AdminDashboard } from "../features/admin/AdminDashboard";
import { CollectorDashboard } from "../features/collector/CollectorDashboard";
import { EarningsPage } from "../features/collector/EarningsPage";
import { GuidePage } from "../features/collector/GuidePage";
import { ProfilePage } from "../features/collector/ProfilePage";
import { SubmissionDetail } from "../features/collector/SubmissionDetail";
import { SubmissionsPage } from "../features/collector/SubmissionsPage";
import { UploadPage } from "../features/collector/UploadPage";
import { PublicHomePage } from "../features/public/PublicHomePage";
import { TeamDashboard } from "../features/team/TeamDashboard";
import { DashboardShell } from "../layout/DashboardShell";
import { roleHome } from "./navigation";

function requiredRole(path: string): Role | null {
  if (path.startsWith("/collector")) return "collector";
  if (path.startsWith("/team")) return "leader";
  if (path.startsWith("/admin")) return "admin";
  return null;
}

export function PlatformApp({ initialPath }: { initialPath: string }) {
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
    page = <TeamDashboard />;
  } else if (currentUser.role === "admin") {
    page = <AdminDashboard />;
  }

  return (
    <DashboardShell currentPath={safePath} navigate={navigate}>
      {page}
    </DashboardShell>
  );
}
