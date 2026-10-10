import { MARK_PATH } from "@/lib/mark";

// The brain mark, flat. One path, drawn in whatever colour the text around it is, so the same
// component is the logo in the header, the stamp on a demo badge and the bullet in the band.
export default function Mark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <path fill="currentColor" d={MARK_PATH} />
    </svg>
  );
}
