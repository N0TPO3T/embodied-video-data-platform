import { PlatformApp } from "@/src/app/PlatformApp";
import { resolveRouteAccess } from "@/src/auth/server/access";
import {
  getBackendSession,
  listBackendAccounts,
  listBackendTeams,
} from "@/src/auth/server/backendClient";
import { IdentityProvider } from "@/src/auth/client/IdentityContext";
import { DemoStoreProvider } from "@/src/data/DemoStoreContext";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug = [] } = await params;
  const initialPath = slug.length ? `/${slug.join("/")}` : "/";
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("evdp_session")?.value ?? null;

  if (!sessionToken) {
    const access = resolveRouteAccess(initialPath, null);
    if (access.kind === "redirect") {
      redirect(access.location);
    }
    return (
      <DemoStoreProvider>
        <PlatformApp initialPath={initialPath} />
      </DemoStoreProvider>
    );
  }

  const session = await getBackendSession(sessionToken);
  const currentAccount = session?.user ?? null;
  const access = resolveRouteAccess(initialPath, currentAccount);
  if (access.kind === "redirect") {
    redirect(access.location);
  }
  const [accounts, teams] = currentAccount
    ? await Promise.all([
        listBackendAccounts(sessionToken),
        listBackendTeams(sessionToken),
      ])
    : [[], []];

  if (!currentAccount) {
    return (
      <DemoStoreProvider>
        <PlatformApp initialPath={initialPath} />
      </DemoStoreProvider>
    );
  }

  return (
    <IdentityProvider
      currentAccount={currentAccount}
      accounts={accounts}
      teams={teams}
    >
      <DemoStoreProvider
        currentAccount={currentAccount}
        accounts={accounts}
        teams={teams}
        backendSubmissions={[]}
      >
        <PlatformApp initialPath={initialPath} />
      </DemoStoreProvider>
    </IdentityProvider>
  );
}
