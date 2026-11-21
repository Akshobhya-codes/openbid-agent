import { RunProvider } from "@/components/run-context";
import { RunHeader } from "@/components/run-header";

export default async function RunLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RunProvider id={id}>
      <RunHeader id={id} />
      <div className="mt-6">{children}</div>
    </RunProvider>
  );
}
