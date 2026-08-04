import { PlatformApp } from "@/src/app/PlatformApp";
import { resolveRouteAccess } from "@/src/auth/server/access";
import { getRuntimeServices } from "@/src/auth/server/runtime";
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

  const services = await getRuntimeServices();
  const currentAccount = await services.auth.authenticate(sessionToken);
  const access = resolveRouteAccess(initialPath, currentAccount);
  if (access.kind === "redirect") {
    redirect(access.location);
  }
  const accounts = currentAccount
    ? await services.accounts.listVisible(currentAccount)
    : [];

  return (
    <DemoStoreProvider
      currentAccount={currentAccount ?? undefined}
      accounts={accounts}
    >
      <PlatformApp initialPath={initialPath} />
    </DemoStoreProvider>
  );
}
