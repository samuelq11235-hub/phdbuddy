import { Link } from "react-router-dom";

import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  to?: string;
  showText?: boolean;
}

export function Logo({ className, to = "/", showText = true }: Props) {
  return (
    <Link to={to} className={cn("flex items-center gap-2 font-semibold", className)}>
      <LogoMark />
      {showText && (
        <span className="text-lg tracking-tight">
          PHDBuddy
        </span>
      )}
    </Link>
  );
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      className={cn("h-7 w-7", className)}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path
        d="M7 7 L9 25 M9 25 L13 11 L17 25 M17 25 L19 7"
        className="stroke-primary-foreground"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="23" cy="9" r="2.5" className="fill-primary-foreground" />
      <circle cx="25" cy="20" r="1.8" className="fill-primary-foreground" />
      <line
        x1="23"
        y1="9"
        x2="25"
        y2="20"
        className="stroke-primary-foreground"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
