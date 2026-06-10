import type { ReactNode } from "react";

type PageHeaderProps = {
  kicker: string;
  title: string;
  copy: string;
  actions?: ReactNode;
};

export function PageHeader({ kicker, title, copy, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        <div className="page-kicker">{kicker}</div>
        <h1 className="page-title">{title}</h1>
        <p className="page-copy">{copy}</p>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}
