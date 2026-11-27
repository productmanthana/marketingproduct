import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { Shell } from '@/components/shell';
import Dashboard from '@/pages/dashboard';
import Campaigns from '@/pages/campaigns';
import CampaignDetail from '@/pages/campaign-detail';
import Leads from '@/pages/leads';
import FindLeads from '@/pages/find-leads';
import LeadDetail from '@/pages/lead-detail';
import Inbox from '@/pages/inbox';
import Calls from '@/pages/calls';
import SettingsPage from '@/pages/settings';
import Tasks from '@/pages/tasks';
import Pipeline from '@/pages/pipeline';
import DealDetail from '@/pages/deal-detail';
import Accounts from '@/pages/accounts';
import AccountDetail from '@/pages/account-detail';
import Reports from '@/pages/reports';
import Meetings from '@/pages/meetings';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false } } });

function Router() {
  return (
    <Shell>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/campaigns" component={Campaigns} />
          <Route path="/campaigns/:id" component={CampaignDetail} />
          <Route path="/find-leads" component={FindLeads} />
          <Route path="/leads" component={Leads} />
          <Route path="/leads/:id" component={LeadDetail} />
          <Route path="/inbox" component={Inbox} />
          <Route path="/calls" component={Calls} />
          <Route path="/meetings" component={Meetings} />
          <Route path="/tasks" component={Tasks} />
          <Route path="/pipeline" component={Pipeline} />
          <Route path="/deals/:id" component={DealDetail} />
          <Route path="/accounts" component={Accounts} />
          <Route path="/accounts/:id" component={AccountDetail} />
          <Route path="/reports" component={Reports} />
          <Route path="/settings" component={SettingsPage} />
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
