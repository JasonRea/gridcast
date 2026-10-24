import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
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

export const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute, gameRoute]) });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
