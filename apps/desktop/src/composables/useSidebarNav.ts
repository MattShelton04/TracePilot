import { computed } from "vue";
import { useRouter } from "vue-router";
import type { SidebarSection } from "@/router/types";
import { usePreferencesStore } from "@/stores/preferences";

export interface NavItem {
  id: string;
  label: string;
  to: string;
  icon: string;
  featureFlag?: string;
}

export interface SidebarNavGroups {
  primary: NavItem[];
  advanced: NavItem[];
  orchestration: NavItem[];
  tasks: NavItem[];
  configuration: NavItem[];
}

/**
 * Derives sidebar navigation items from the router's route definitions.
 *
 * Routes that include `meta.sidebar` are collected, grouped by section,
 * sorted by `order`, and filtered by feature flags.
 */
export function useSidebarNav() {
  const router = useRouter();
  const prefsStore = usePreferencesStore();

  const allItems = computed(() => {
    const groups: Record<SidebarSection, NavItem[]> = {
      primary: [],
      advanced: [],
      orchestration: [],
      tasks: [],
      configuration: [],
    };

    for (const route of router.getRoutes()) {
      const sidebar = route.meta?.sidebar;
      if (!sidebar) continue;

      const sidebarId = route.meta.sidebarId ?? route.path;

      const item: NavItem & { _order: number } = {
        id: sidebarId,
        label: sidebar.label,
        to: route.path,
        icon: sidebar.icon,
        featureFlag: route.meta.featureFlag as string | undefined,
        _order: sidebar.order,
      };

      groups[sidebar.section].push(item);
    }

    // Sort each group by order
    for (const section of Object.values(groups)) {
      section.sort((a, b) => ((a as NavItem & { _order: number })._order - (b as NavItem & { _order: number })._order));
    }

    return groups;
  });

  const isVisible = (item: NavItem) =>
    !item.featureFlag || prefsStore.isFeatureEnabled(item.featureFlag);

  const visiblePrimaryNav = computed(() => allItems.value.primary.filter(isVisible));
  const visibleAdvancedNav = computed(() => allItems.value.advanced.filter(isVisible));
  const orchestrationNav = computed(() => allItems.value.orchestration);
  const visibleTasksNav = computed(() => allItems.value.tasks.filter(isVisible));
  const visibleConfigNav = computed(() => allItems.value.configuration.filter(isVisible));

  return {
    visiblePrimaryNav,
    visibleAdvancedNav,
    orchestrationNav,
    visibleTasksNav,
    visibleConfigNav,
  };
}
