import type { AnchorHTMLAttributes, ReactNode } from 'react';

export function useSearch(_options?: unknown) {
  return { next: null, legacyOrgSettingsOrgId: null };
}

export function useParams(_options?: unknown) {
  return { token: 'fixture-invitation-token' };
}

export function useNavigate() {
  return (options: unknown) => {
    document.body.dataset.lastNavigation = JSON.stringify(options);
  };
}

type LinkProps = {
  children: ReactNode;
  className?: string;
  href?: string;
  onClick?: AnchorHTMLAttributes<HTMLAnchorElement>['onClick'];
  to?: string;
  params?: Record<string, string>;
};

export function Link({
  children,
  className,
  href,
  onClick,
  to,
  params,
}: LinkProps) {
  const resolvedHref =
    href ??
    (to === '/projects/$projectId' && params?.projectId
      ? `/projects/${params.projectId}`
      : (to ?? '#'));

  return (
    <a
      className={className}
      href={resolvedHref}
      onClick={(event) => {
        event.preventDefault();
        document.body.dataset.lastNavigation = resolvedHref;
        onClick?.(event);
      }}
    >
      {children}
    </a>
  );
}
