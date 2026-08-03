import { PlatformApp } from "@/src/app/PlatformApp";
import { DemoStoreProvider } from "@/src/data/DemoStoreContext";

export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug = [] } = await params;
  const initialPath = slug.length ? `/${slug.join("/")}` : "/";

  return (
    <DemoStoreProvider>
      <PlatformApp initialPath={initialPath} />
    </DemoStoreProvider>
  );
}
