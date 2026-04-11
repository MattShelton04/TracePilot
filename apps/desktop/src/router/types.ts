import "vue-router";

export type SidebarSection = "primary" | "advanced" | "orchestration" | "tasks" | "configuration";

export interface SidebarMeta {
  /** Which sidebar section this route appears in */
  section: SidebarSection;
  /** Short label for the sidebar (may differ from route title) */
  label: string;
  /** Icon key for SVG selection in the sidebar template */
  icon: string;
  /** Sort order within the section (lower = higher) */
  order: number;
}

declare module "vue-router" {
  interface RouteMeta {
    /** Page title for breadcrumbs/header */
    title?: string;
    /** Sidebar nav item ID for active state */
    sidebarId?: string;
    /** Feature flag key — route is blocked when flag is disabled */
    featureFlag?: string;
    /** Sidebar navigation metadata — routes with this appear in the sidebar */
    sidebar?: SidebarMeta;
  }
}
