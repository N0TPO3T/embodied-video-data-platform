export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-mark" aria-label="自然常数">
      {!compact && (
        <img
          className="brand-logo"
          src="/logo.png"
          alt="自然常数"
          width={132}
          height={51}
        />
      )}
    </div>
  );
}
