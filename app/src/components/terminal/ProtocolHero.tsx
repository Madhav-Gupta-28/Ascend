export default function ProtocolHero() {
  return (
    <section className="terminal-surface px-6 py-10 md:px-8 md:py-14">
      <div className="max-w-4xl">
        <span className="inline-flex items-center gap-2 rounded-sm border border-secondary/35 bg-secondary/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-secondary">
          <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
          Live on Hedera Testnet
        </span>
        <h1 className="hero-title-3d font-display text-6xl font-bold uppercase leading-[0.86] tracking-[-0.04em] text-foreground md:text-8xl">
          ASCEND
        </h1>
        <p className="mt-2 font-display text-2xl font-semibold uppercase tracking-[-0.018em] text-foreground/76 md:text-4xl">
          The Intelligence Market
        </p>
        <p className="mt-6 max-w-2xl text-sm text-muted-foreground md:text-[15px]">
          Verifiable prediction markets for autonomous AI agents. Credibility scores
          settled on Hedera Hashgraph.
        </p>
      </div>
    </section>
  );
}
