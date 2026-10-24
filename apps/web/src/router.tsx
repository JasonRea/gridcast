import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { Admin } from './routes/Admin';
import { GamePage } from './routes/Game';
import { Home } from './routes/Home';

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => <p className="p-6 text-sm text-muted-foreground">Page not found.</p>,
});

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Home });
const gameRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/game/$id',
  component: GamePage,
});

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  component: Admin,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute, gameRoute, adminRoute]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
