import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Shell } from '@/components/layout/Shell';

// Pages
import ProjectsList from '@/pages/ProjectsList';
import ProjectDetail from '@/pages/ProjectDetail';
import ActivityList from '@/pages/ActivityList';
import Settings from '@/pages/Settings';
import SceneWorkspace from '@/pages/SceneWorkspace';
import ShotWorkspace from '@/pages/ShotWorkspace';
import Shoot from '@/pages/Shoot';
import ShootLauncher from '@/pages/ShootLauncher';
import Results from '@/pages/Results';
import Reports from '@/pages/Reports';
import ScreenplayImport from '@/pages/ScreenplayImport';

import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function Router() {
  return (
    <Shell>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={ProjectsList} />
          <Route path="/projects" component={ProjectsList} />
          <Route path="/projects/:projectId/screenplay" component={ScreenplayImport} />
          <Route path="/projects/:projectId" component={ProjectDetail} />
          <Route path="/scenes/:sceneId" component={SceneWorkspace} />
          <Route path="/shots/:shotId/results" component={Results} />
          <Route path="/shots/:shotId" component={ShotWorkspace} />
          <Route path="/shoot/:shotId" component={Shoot} />
          <Route path="/shoot" component={ShootLauncher} />
          <Route path="/activity" component={ActivityList} />
          <Route path="/reports" component={Reports} />
          <Route path="/settings" component={Settings} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Shell>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;