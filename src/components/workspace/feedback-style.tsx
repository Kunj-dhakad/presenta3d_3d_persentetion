/**
 * The looks of the viewer's feedback form (PHP: views/default/presentation3d/viewer.php,
 * $fbIcon): the 1-5 rating as faces, stars, a meter or thumbs. These pictures are
 * the same drawings, for the Settings drawer's picker.
 */

export const FEEDBACK_STYLES = [
  { id: "emoji", label: "Emoji" },
  { id: "stars", label: "Stars" },
  { id: "meter", label: "Meter" },
  { id: "thumbs", label: "Thumbs" },
] as const;
export type FeedbackStyle = (typeof FEEDBACK_STYLES)[number]["id"];

const INK = "#173a5e";
const BLUE = "#0ea5e9";

/** One rating's picture: `level` 1..5, fuller as it goes up. */
export function FeedbackIcon({ style, level, className }: { style: FeedbackStyle; level: 1 | 2 | 3 | 4 | 5; className?: string }) {
  const fill = [0, 0.18, 0.42, 0.7, 1][level - 1];
  if (style === "emoji") {
    const mouth = [
      <g key="m">
        <path d="M13 29 Q20 21 27 29" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
        <path d="M11 12.5 L16 14.5 M29 12.5 L24 14.5" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      </g>,
      <path key="m" d="M14 27.5 Q20 23.5 26 27.5" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />,
      <path key="m" d="M14 26 L26 26" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />,
      <path key="m" d="M14 24 Q20 29.5 26 24" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />,
      <path key="m" d="M12 22 Q20 34 28 22 Z" fill={INK} />,
    ][level - 1];
    return (
      <svg viewBox="0 0 40 40" aria-hidden className={className}>
        <circle cx="20" cy="20" r="17" fill="#d6ecfb" stroke={INK} strokeWidth="2" />
        {level === 5 ? (
          <path d="M12 17 Q14.5 13.5 17 17 M23 17 Q25.5 13.5 28 17" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
        ) : (
          <>
            <circle cx="14.5" cy="17" r="2" fill={INK} />
            <circle cx="25.5" cy="17" r="2" fill={INK} />
          </>
        )}
        {mouth}
      </svg>
    );
  }
  if (style === "stars") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden className={className}>
        <path d="M12 2.6l2.85 5.96 6.55.83-4.82 4.53 1.25 6.5L12 17.24 6.17 20.42l1.25-6.5L2.6 9.39l6.55-.83z" fill={BLUE} fillOpacity={fill} stroke={BLUE} strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    );
  }
  if (style === "meter") {
    const a = (Math.PI * level) / 5;
    const p = (r: number) => `${(20 - r * Math.cos(a)).toFixed(2)} ${(25 - r * Math.sin(a)).toFixed(2)}`;
    return (
      <svg viewBox="0 0 40 30" aria-hidden className={className}>
        <path d="M5 25 A15 15 0 0 1 35 25" fill="none" stroke="#cfe7fb" strokeWidth="7" />
        <path d={`M5 25 A15 15 0 0 1 ${p(15)}`} fill="none" stroke={BLUE} strokeWidth="7" />
        <path d={`M20 25 L${p(11)}`} stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="20" cy="25" r="3" fill={INK} />
      </svg>
    );
  }
  const turn = level <= 2 ? 180 : 0;
  const thumbFill = [0.85, 0.3, 0.3, 0.65, 1][level - 1];
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} overflow="visible">
      <g transform={`rotate(${turn} 12 12)`}>
        <rect x="3" y="10" width="4" height="10" rx="1" fill={INK} />
        <path d="M8 10 L11 4 C11.6 2.9 13.6 3.1 13.5 5 L13 9 H19 C20.3 9 21.2 10.2 20.9 11.4 L19.4 18.4 C19.2 19.4 18.3 20 17.4 20 H8 Z" fill={BLUE} fillOpacity={thumbFill} stroke={BLUE} strokeWidth="1.2" strokeLinejoin="round" />
      </g>
      {level === 5 ? <path d="M20.5 2.5 L21.5 0.8 M22.6 4.6 L24 3.8 M18 1.6 L17.8 0" stroke={BLUE} strokeWidth="1.3" strokeLinecap="round" /> : null}
    </svg>
  );
}
