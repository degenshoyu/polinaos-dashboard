// components/dashboard/navLinks.config.ts
export type NavItem = {
  label: string;
  href: string;
  disabled?: boolean;
  external?: boolean;
};

const navLinks: NavItem[] = [
  { label: "Home",      href: "https://www.polinaos.com/",          external: true },
  { label: "Docs",      href: "https://docs.polinaos.com/",         external: true },
  { label: "Community", href: "https://www.polinaos.com/community", external: true },
];

export default navLinks;
