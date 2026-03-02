import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Building2,
  CheckCircle,
  XCircle,
  Clock,
  Ban,
  DollarSign,
  Users,
  AlertTriangle,
  LogOut,
  Search,
  TrendingUp,
  CreditCard,
  ShieldAlert,
  Package,
  RefreshCw,
} from "lucide-react";
import type { Company } from "@shared/schema";

const PLAN_PRICES: Record<string, number> = {
  starter: 49,
  professional: 99,
  enterprise: 249,
};

export default function MasterAdminDashboard() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [dialogAction, setDialogAction] = useState<"approve" | "reject" | "suspend" | null>(null);
  const [search, setSearch] = useState("");

  const { data: companies = [], isLoading } = useQuery<Company[]>({
    queryKey: ['/api/master-admin/companies'],
    refetchInterval: 30000,
  });

  const { data: stats } = useQuery<any>({
    queryKey: ['/api/master-admin/stats'],
    refetchInterval: 30000,
  });

  const approveMutation = useMutation({
    mutationFn: (companyId: string) =>
      apiRequest(`/api/master-admin/companies/${companyId}/approve`, 'POST'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/master-admin/companies'] });
      queryClient.invalidateQueries({ queryKey: ['/api/master-admin/stats'] });
      toast({ title: "Company approved successfully" });
      setDialogAction(null);
      setSelectedCompany(null);
    },
    onError: () => toast({ title: "Failed to approve company", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: (companyId: string) =>
      apiRequest(`/api/master-admin/companies/${companyId}/reject`, 'POST'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/master-admin/companies'] });
      queryClient.invalidateQueries({ queryKey: ['/api/master-admin/stats'] });
      toast({ title: "Company rejected" });
      setDialogAction(null);
      setSelectedCompany(null);
    },
    onError: () => toast({ title: "Failed to reject company", variant: "destructive" }),
  });

  const suspendMutation = useMutation({
    mutationFn: ({ companyId, reason }: { companyId: string; reason: string }) =>
      apiRequest(`/api/master-admin/companies/${companyId}/suspend`, 'POST', { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/master-admin/companies'] });
      queryClient.invalidateQueries({ queryKey: ['/api/master-admin/stats'] });
      toast({ title: "Company suspended" });
      setDialogAction(null);
      setSelectedCompany(null);
      setSuspendReason("");
    },
    onError: () => toast({ title: "Failed to suspend company", variant: "destructive" }),
  });

  const handleAction = (company: Company, action: "approve" | "reject" | "suspend") => {
    setSelectedCompany(company);
    setDialogAction(action);
  };

  const confirmAction = () => {
    if (!selectedCompany) return;
    switch (dialogAction) {
      case "approve": approveMutation.mutate(selectedCompany.id); break;
      case "reject": rejectMutation.mutate(selectedCompany.id); break;
      case "suspend": suspendMutation.mutate({ companyId: selectedCompany.id, reason: suspendReason }); break;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved": return <Badge className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />Approved</Badge>;
      case "pending_approval": return <Badge className="bg-yellow-100 text-yellow-800"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case "suspended": return <Badge className="bg-red-100 text-red-800"><Ban className="w-3 h-3 mr-1" />Suspended</Badge>;
      case "rejected": return <Badge className="bg-gray-100 text-gray-800"><XCircle className="w-3 h-3 mr-1" />Rejected</Badge>;
      default: return <Badge>{status}</Badge>;
    }
  };

  const getBillingBadge = (status: string) => {
    switch (status) {
      case "active": return <Badge className="bg-green-100 text-green-800"><DollarSign className="w-3 h-3 mr-1" />Active</Badge>;
      case "trialing": return <Badge className="bg-blue-100 text-blue-800"><Clock className="w-3 h-3 mr-1" />Trial</Badge>;
      case "past_due": return <Badge className="bg-orange-100 text-orange-800"><AlertTriangle className="w-3 h-3 mr-1" />Past Due</Badge>;
      case "canceled": return <Badge className="bg-gray-100 text-gray-800"><XCircle className="w-3 h-3 mr-1" />Canceled</Badge>;
      case "unpaid": return <Badge className="bg-red-100 text-red-800"><ShieldAlert className="w-3 h-3 mr-1" />Unpaid</Badge>;
      default: return <Badge className="bg-gray-100 text-gray-500">No Payment</Badge>;
    }
  };

  const getPlanBadge = (planType: string) => {
    switch (planType) {
      case "starter": return <Badge className="bg-gray-100 text-gray-700">Starter $49</Badge>;
      case "professional": return <Badge className="bg-blue-100 text-blue-700">Pro $99</Badge>;
      case "enterprise": return <Badge className="bg-purple-100 text-purple-700">Enterprise $249</Badge>;
      default: return <Badge className="bg-gray-50 text-gray-400">No Plan</Badge>;
    }
  };

  const estimatedMRR = companies
    .filter(c => c.billingStatus === 'active' || c.billingStatus === 'trialing')
    .reduce((sum, c) => sum + (PLAN_PRICES[(c as any).planType] || 0), 0);

  const filteredCompanies = companies.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.name?.toLowerCase().includes(q) ||
      c.contactEmail?.toLowerCase().includes(q) ||
      c.slug?.toLowerCase().includes(q)
    );
  });

  const pendingCompanies = filteredCompanies.filter(c => c.status === 'pending_approval');
  const payingCompanies = filteredCompanies.filter(c => c.billingStatus === 'active');
  const pastDueCompanies = filteredCompanies.filter(c => c.billingStatus === 'past_due' || c.billingStatus === 'unpaid');

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2 text-lg text-gray-600">
          <RefreshCw className="w-5 h-5 animate-spin" />
          Loading platform data...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4 shadow-sm">
        <div className="flex justify-between items-center max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="bg-orange-500 p-2 rounded-lg">
              <ShieldAlert className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Master Admin</h1>
              <p className="text-sm text-gray-500">Platform management & oversight</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600 bg-gray-100 px-3 py-1 rounded-full">{user?.email}</span>
            <Button variant="outline" size="sm" onClick={() => logout()}>
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        {/* Top Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Total Signups</p>
                  <p className="text-3xl font-bold text-gray-900">{companies.length}</p>
                </div>
                <Building2 className="w-10 h-10 text-blue-400" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Pending Review</p>
                  <p className="text-3xl font-bold text-yellow-600">{stats?.pending || 0}</p>
                </div>
                <Clock className="w-10 h-10 text-yellow-400" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Active Paying</p>
                  <p className="text-3xl font-bold text-green-600">{stats?.billingActive || 0}</p>
                </div>
                <CreditCard className="w-10 h-10 text-green-400" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Est. MRR</p>
                  <p className="text-3xl font-bold text-purple-700">${estimatedMRR.toLocaleString()}</p>
                </div>
                <TrendingUp className="w-10 h-10 text-purple-400" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Secondary Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <Card className="text-center py-3">
            <p className="text-xs text-gray-500 mb-1">Approved</p>
            <p className="text-2xl font-bold text-green-600">{stats?.approved || 0}</p>
          </Card>
          <Card className="text-center py-3">
            <p className="text-xs text-gray-500 mb-1">Suspended</p>
            <p className="text-2xl font-bold text-red-500">{stats?.suspended || 0}</p>
          </Card>
          <Card className="text-center py-3">
            <p className="text-xs text-gray-500 mb-1">Past Due</p>
            <p className="text-2xl font-bold text-orange-500">{stats?.billingPastDue || 0}</p>
          </Card>
          <Card className="text-center py-3">
            <p className="text-xs text-gray-500 mb-1">Trialing</p>
            <p className="text-2xl font-bold text-blue-500">{stats?.billingTrialing || 0}</p>
          </Card>
          <Card className="text-center py-3">
            <p className="text-xs text-gray-500 mb-1">No Payment</p>
            <p className="text-2xl font-bold text-gray-400">{stats?.billingNone || 0}</p>
          </Card>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search by company name, email, or slug..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="pending" className="space-y-4">
          <TabsList>
            <TabsTrigger value="pending">
              Pending ({pendingCompanies.length})
            </TabsTrigger>
            <TabsTrigger value="paying">
              Paying ({payingCompanies.length})
            </TabsTrigger>
            <TabsTrigger value="pastdue">
              Past Due / Unpaid ({pastDueCompanies.length})
            </TabsTrigger>
            <TabsTrigger value="all">
              All Companies ({filteredCompanies.length})
            </TabsTrigger>
          </TabsList>

          {/* Pending Tab */}
          <TabsContent value="pending">
            <Card>
              <CardHeader>
                <CardTitle>Pending Approvals</CardTitle>
                <CardDescription>New business signups waiting for your review</CardDescription>
              </CardHeader>
              <CardContent>
                {pendingCompanies.length === 0 ? (
                  <div className="text-center py-10 text-gray-400">
                    <CheckCircle className="w-12 h-12 mx-auto mb-2 opacity-30" />
                    No pending approval requests
                  </div>
                ) : (
                  <CompanyTable
                    companies={pendingCompanies}
                    getStatusBadge={getStatusBadge}
                    getBillingBadge={getBillingBadge}
                    getPlanBadge={getPlanBadge}
                    onAction={handleAction}
                    showPlan
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Paying Tab */}
          <TabsContent value="paying">
            <Card>
              <CardHeader>
                <CardTitle>Active Paying Companies</CardTitle>
                <CardDescription>Companies with active Stripe subscriptions</CardDescription>
              </CardHeader>
              <CardContent>
                {payingCompanies.length === 0 ? (
                  <div className="text-center py-10 text-gray-400">
                    <DollarSign className="w-12 h-12 mx-auto mb-2 opacity-30" />
                    No active paying companies yet
                  </div>
                ) : (
                  <CompanyTable
                    companies={payingCompanies}
                    getStatusBadge={getStatusBadge}
                    getBillingBadge={getBillingBadge}
                    getPlanBadge={getPlanBadge}
                    onAction={handleAction}
                    showPlan
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Past Due Tab */}
          <TabsContent value="pastdue">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-orange-600">
                  <AlertTriangle className="w-5 h-5" />
                  Past Due / Unpaid
                </CardTitle>
                <CardDescription>Companies with failed or overdue payments that may need follow-up</CardDescription>
              </CardHeader>
              <CardContent>
                {pastDueCompanies.length === 0 ? (
                  <div className="text-center py-10 text-gray-400">
                    <CheckCircle className="w-12 h-12 mx-auto mb-2 opacity-30" />
                    No past due accounts
                  </div>
                ) : (
                  <CompanyTable
                    companies={pastDueCompanies}
                    getStatusBadge={getStatusBadge}
                    getBillingBadge={getBillingBadge}
                    getPlanBadge={getPlanBadge}
                    onAction={handleAction}
                    showPlan
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* All Companies Tab */}
          <TabsContent value="all">
            <Card>
              <CardHeader>
                <CardTitle>All Companies</CardTitle>
                <CardDescription>Every registered business on the platform</CardDescription>
              </CardHeader>
              <CardContent>
                {filteredCompanies.length === 0 ? (
                  <div className="text-center py-10 text-gray-400">
                    <Building2 className="w-12 h-12 mx-auto mb-2 opacity-30" />
                    No companies found
                  </div>
                ) : (
                  <CompanyTable
                    companies={filteredCompanies}
                    getStatusBadge={getStatusBadge}
                    getBillingBadge={getBillingBadge}
                    getPlanBadge={getPlanBadge}
                    onAction={handleAction}
                    showPlan
                    showStatus
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Action Dialog */}
      <Dialog open={dialogAction !== null} onOpenChange={() => { setDialogAction(null); setSelectedCompany(null); setSuspendReason(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogAction === "approve" && "Approve Company"}
              {dialogAction === "reject" && "Reject Company"}
              {dialogAction === "suspend" && "Suspend Company"}
            </DialogTitle>
            <DialogDescription>
              {dialogAction === "approve" && `Approve "${selectedCompany?.name}"? They will gain full platform access.`}
              {dialogAction === "reject" && `Reject "${selectedCompany?.name}"? This action cannot be undone.`}
              {dialogAction === "suspend" && `Suspending "${selectedCompany?.name}" will immediately disable their access.`}
            </DialogDescription>
          </DialogHeader>

          {dialogAction === "suspend" && (
            <div className="py-2">
              <Textarea
                placeholder="Reason for suspension (optional, shown to account)"
                value={suspendReason}
                onChange={e => setSuspendReason(e.target.value)}
                rows={3}
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogAction(null); setSelectedCompany(null); setSuspendReason(""); }}>
              Cancel
            </Button>
            <Button
              variant={dialogAction === "approve" ? "default" : "destructive"}
              onClick={confirmAction}
              disabled={approveMutation.isPending || rejectMutation.isPending || suspendMutation.isPending}
            >
              {(approveMutation.isPending || rejectMutation.isPending || suspendMutation.isPending) ? "Processing..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CompanyTable({
  companies,
  getStatusBadge,
  getBillingBadge,
  getPlanBadge,
  onAction,
  showPlan,
  showStatus,
}: {
  companies: Company[];
  getStatusBadge: (s: string) => JSX.Element;
  getBillingBadge: (s: string) => JSX.Element;
  getPlanBadge: (s: string) => JSX.Element;
  onAction: (c: Company, a: "approve" | "reject" | "suspend") => void;
  showPlan?: boolean;
  showStatus?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Company</TableHead>
            <TableHead>Contact</TableHead>
            {showStatus && <TableHead>Status</TableHead>}
            <TableHead>Payment</TableHead>
            {showPlan && <TableHead>Plan</TableHead>}
            <TableHead>Signed Up</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {companies.map(company => (
            <TableRow key={company.id}>
              <TableCell>
                <div>
                  <p className="font-medium">{company.name}</p>
                  <p className="text-xs text-gray-400">{company.slug}</p>
                </div>
              </TableCell>
              <TableCell>
                <div>
                  <p className="text-sm">{company.contactEmail}</p>
                  {company.contactPhone && <p className="text-xs text-gray-400">{company.contactPhone}</p>}
                </div>
              </TableCell>
              {showStatus && (
                <TableCell>{getStatusBadge(company.status || 'pending_approval')}</TableCell>
              )}
              <TableCell>{getBillingBadge(company.billingStatus || 'none')}</TableCell>
              {showPlan && (
                <TableCell>{getPlanBadge((company as any).planType || '')}</TableCell>
              )}
              <TableCell className="text-sm text-gray-500">
                {company.createdAt ? new Date(company.createdAt).toLocaleDateString() : 'N/A'}
              </TableCell>
              <TableCell>
                <div className="flex gap-2 flex-wrap">
                  {company.status === "pending_approval" && (
                    <>
                      <Button size="sm" onClick={() => onAction(company, "approve")}>
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Approve
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => onAction(company, "reject")}>
                        <XCircle className="w-3 h-3 mr-1" />
                        Reject
                      </Button>
                    </>
                  )}
                  {company.status === "approved" && (
                    <Button size="sm" variant="outline" onClick={() => onAction(company, "suspend")}>
                      <Ban className="w-3 h-3 mr-1" />
                      Suspend
                    </Button>
                  )}
                  {company.status === "suspended" && (
                    <Button size="sm" onClick={() => onAction(company, "approve")}>
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Reactivate
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
