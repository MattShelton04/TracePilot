import 'vue-router';

declare module 'vue-router' {
  interface RouteMeta {
    /** Page title for breadcrumbs/header */
    title?: string;
    /** Sidebar nav item ID for active state */
    sidebarId?: string;
    /** Feature flag key — route is blocked when flag is disabled */
    featureFlag?: string;
  }
}
