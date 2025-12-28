import type { ReactNode } from "react";

export default function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, fontFamily: "system-ui" }}>
      <div style={{ width: "100%", maxWidth: 420, border: "1px solid #ddd", borderRadius: 14, padding: 18 }}>
        <h1 style={{ margin: 0 }}>{title}</h1>
        {subtitle && <p style={{ marginTop: 6, opacity: 0.7 }}>{subtitle}</p>}
        <div style={{ marginTop: 14 }}>{children}</div>
      </div>
    </div>
  );
}
