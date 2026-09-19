export function Marca({
  claro = false,
  compacto = false,
}: {
  readonly claro?: boolean;
  readonly compacto?: boolean;
}) {
  const cor = claro ? '#FFFFFF' : 'var(--color-primary-600)';
  const tamanho = compacto ? 26 : 36;

  return (
    <div className="flex items-center gap-3">
      <svg
        width={tamanho}
        height={tamanho}
        viewBox="0 0 34 34"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect x="1.25" y="1.25" width="31.5" height="31.5" rx="7" stroke={cor} strokeWidth="2.4" />
        <path
          d="M9 12.5 L17 8 L25 12.5 L25 21.5 L17 26 L9 21.5 Z"
          stroke={cor}
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        <path d="M9 12.5 L17 17 L25 12.5" stroke={cor} strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M17 17 L17 26" stroke={cor} strokeWidth="2.4" strokeLinejoin="round" />
      </svg>
      <span
        className="font-display font-bold tracking-[0.01em]"
        style={{ color: cor, fontSize: compacto ? 16 : 21 }}
      >
        Estoque
      </span>
    </div>
  );
}
