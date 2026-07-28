export default function LayoutAuth({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="mb-8 text-center">
        <p className="text-sm font-semibold tracking-[0.18em] text-primary uppercase">
          Agente de WhatsApp
        </p>
        <p className="mt-2 max-w-xs text-sm text-muted-foreground">
          Inbox conversacional con IA para negocios
        </p>
      </div>

      {children}
    </main>
  );
}
