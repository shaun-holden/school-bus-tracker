import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  LogOut
} from "lucide-react";
import type { Company } from "@shared/schema";

export default function MasterAdminDashboard() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [dialogAction, setDialogAction] = useState<"approve" | "reject" | "suspend" | null>(null);

  const { data: companies = [], isLoading } = useQuery<Company[]>({
    queryKey: ['/api/master-admin/companies'],
  });

  const { data: pendingCompanies = [] } = useQuery<Company[]>({
    queryKey: ['/api/master-admin/companies/status/pending_approval'],
  });

  const approveMutation = useMutation({
    mutationFn: (companyId: string) => 
      apiRequest(`/api/master-admin/companies/${companyId}/approve`, 'POST'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/master-admin/companies'] });
      queryClient.invalidateQueries({ queryKey: ['/api/master-admin/companies/status/pending_approval'] });
      toast({ title: "Company approved successfully" });
      setDialogAction(null);
      setSelectedCompany(null);
    },
    onError: () => {
      toast({ title: "Failed to approve company", variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (companyId: string) => 
      apiRequest(`/api/master-admin/companies/${companyId}/reject`, 'POST'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/master-admin/companies'] });
      queryClient.invalidateQueries({ queryKey: ['/api/master-admin/companies/status/pending_approval'] });
      toast({ title: "Company rejected" });
      setDialogAction(null);
      setSelectedCompany(null);
    },
    onError: () => {
      toast({ title: "Failed to reject company", variant: "destructive" });
    },
  });

  const suspendMutation = useMutation({
    mutationFn: ({ companyId, reason }: { companyId: string; reason: string }) => 
      apiRequest(`/api/master-admin/companies/${companyId}/suspend`, 'POST', { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/master-admin/companies'] });
      toast({ title: "Company suspended" });
      setDialogAction(null);
      setSelectedCompany(null);
      setSuspendReason("");
    },
    onError: () => {
      toast({ title: "Failed to suspend company", variant: "destructive" });
    },
  });

  const handleAction = (company: Company, action: "approve" | "reject" | "suspend") => {
    setSelectedCompany(company);
    setDialogAction(action);
  };

  const confirmAction = () => {
    if (!selectedCompany) return;

    switch (dialogAction) {
      case "approve":
        approveMutation.mutate(selectedCompany.id);
        break;
      case "reject":
        rejectMutation.mutate(selectedCompany.id);
        break;
      case "suspend":
        suspendMutation.mutate({ companyId: selectedCompany.id, reason: suspendReason });
        break;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved":
        return <Badge className="bg-green-100 text-green-800" data-testid="status-approved"><CheckCircle className="w-3 h-3 mr-1" />Approved</Badge>;
      case "pending_approval":
        return <Badge className="bg-yellow-100 text-yellow-800" data-testid="status-pending"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case "suspended":
        return <Badge className="bg-red-100 text-red-800" data-testid="status-suspended"><Ban className="w-3 h-3 mr-1" />Suspended</Badge>;
      case "rejected":
        return <Badge className="bg-gray-100 text-gray-800" data-testid="status-rejected"><XCircle className="w-3 h-3 mr-1" />Rejected</Badge>;
      default:
        return <Badge data-testid="status-unknown">{status}</Badge>;
    }
  };

  const getBillingBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-100 text-green-800" data-testid="billing-active">Active</Badge>;
      case "trialing":
        return <Badge className="bg-blue-100 text-blue-800" data-testid="billing-trial">Trial</Badge>;
      case "past_due":
        return <Badge className="bg-orange-100 text-orange-800" data-testid="billing-past-due">Past Due</Badge>;
      case "canceled":
        return <Badge className="bg-gray-100 text-gray-800" data-testid="billing-canceled">Canceled</Badge>;
      case "none":
        return <Badge className="bg-gray-100 text-gray-600" data-testid="billing-none">No Payment</Badge>;
      default:
        return <Badge data-testid="billing-unknown">{status}</Badge>;
    }
  };

  const stats = {
    total: companies.length,
    pending: companies.filter(c => c.status === "pending_approval").length,
    active: companies.filter(c => c.status === "approved" && c.isActive).length,
    suspended: companies.filter(c => c.status === "suspended").length,
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900" data-testid="text-page-title">Master Admin Dashboard</h1>
            <p className="text-gray-600">Manage all business tenants</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600" data-testid="text-user-email">{user?.email}</span>
            <Button variant="outline" size="sm" onClick={() => logout()} data-testid="button-logout">
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card data-testid="card-stat-total">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Total Companies</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center">
                <Building2 className="w-8 h-8 text-blue-500 mr-3" />
                <span className="text-3xl font-bold" data-testid="text-stat-total">{stats.total}</span>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-stat-pending">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Pending Approval</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center">
                <Clock className="w-8 h-8 text-yellow-500 mr-3" />
                <span className="text-3xl font-bold" data-testid="text-stat-pending">{stats.pending}</span>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-stat-active">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Active Companies</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center">
                <CheckCircle className="w-8 h-8 text-green-500 mr-3" />
                <span className="text-3xl font-bold" data-testid="text-stat-active">{stats.active}</span>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-stat-suspended">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Suspended</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center">
                <AlertTriangle className="w-8 h-8 text-red-500 mr-3" />
                <span className="text-3xl font-bold" data-testid="text-stat-suspended">{stats.suspended}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="pending" className="space-y-4">
          <TabsList data-testid="tabs-companies">
            <TabsTrigger value="pending" data-testid="tab-pending">
              Pending Approval ({stats.pending})
            </TabsTrigger>
            <TabsTrigger value="all" data-testid="tab-all">
              All Companies
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending">
            <Card>
              <CardHeader>
                <CardTitle>Pending Approvals</CardTitle>
                <CardDescription>Review and approve new business signups</CardDescription>
              </CardHeader>
              <CardContent>
                {pendingCompanies.length === 0 ? (
                  <div className="text-center py-8 text-gray-500" data-testid="text-no-pending">
                    No pending approval requests
                  </div>
                ) : (
                  <Table data-testid="table-pending-companies">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Company</TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead>Billing</TableHead>
                        <TableHead>Registered</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingCompanies.map((company) => (
                        <TableRow key={company.id} data-testid={`row-company-${company.id}`}>
                          <TableCell>
                            <div>
                              <p className="font-medium" data-testid={`text-company-name-${company.id}`}>{company.name}</p>
                              <p className="text-sm text-gray-500">{company.slug}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <p data-testid={`text-company-email-${company.id}`}>{company.contactEmail}</p>
                            {company.contactPhone && <p className="text-sm text-gray-500">{company.contactPhone}</p>}
                          </TableCell>
                          <TableCell>{getBillingBadge(company.billingStatus || 'none')}</TableCell>
                          <TableCell className="text-sm text-gray-500">
                            {company.createdAt ? new Date(company.createdAt).toLocaleDateString() : 'N/A'}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button 
                                size="sm" 
                                onClick={() => handleAction(company, "approve")}
                                data-testid={`button-approve-${company.id}`}
                              >
                                <CheckCircle className="w-4 h-4 mr-1" />
                                Approve
                              </Button>
                              <Button 
                                size="sm" 
                                variant="destructive"
                                onClick={() => handleAction(company, "reject")}
                                data-testid={`button-reject-${company.id}`}
                              >
                                <XCircle className="w-4 h-4 mr-1" />
                                Reject
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="all">
            <Card>
              <CardHeader>
                <CardTitle>All Companies</CardTitle>
                <CardDescription>View and manage all registered companies</CardDescription>
              </CardHeader>
              <CardContent>
                {companies.length === 0 ? (
                  <div className="text-center py-8 text-gray-500" data-testid="text-no-companies">
                    No companies registered yet
                  </div>
                ) : (
                  <Table data-testid="table-all-companies">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Company</TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Billing</TableHead>
                        <TableHead>Registered</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {companies.map((company) => (
                        <TableRow key={company.id} data-testid={`row-company-${company.id}`}>
                          <TableCell>
                            <div>
                              <p className="font-medium" data-testid={`text-company-name-${company.id}`}>{company.name}</p>
                              <p className="text-sm text-gray-500">{company.slug}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <p data-testid={`text-company-email-${company.id}`}>{company.contactEmail}</p>
                            {company.contactPhone && <p className="text-sm text-gray-500">{company.contactPhone}</p>}
                          </TableCell>
                          <TableCell>{getStatusBadge(company.status || 'pending_approval')}</TableCell>
                          <TableCell>{getBillingBadge(company.billingStatus || 'none')}</TableCell>
                          <TableCell className="text-sm text-gray-500">
                            {company.createdAt ? new Date(company.createdAt).toLocaleDateString() : 'N/A'}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              {company.status === "pending_approval" && (
                                <>
                                  <Button 
                                    size="sm" 
                                    onClick={() => handleAction(company, "approve")}
                                    data-testid={`button-approve-${company.id}`}
                                  >
                                    Approve
                                  </Button>
                                  <Button 
                                    size="sm" 
                                    variant="destructive"
                                    onClick={() => handleAction(company, "reject")}
                                    data-testid={`button-reject-${company.id}`}
                                  >
                                    Reject
                                  </Button>
                                </>
                              )}
                              {company.status === "approved" && (
                                <Button 
                                  size="sm" 
                                  variant="outline"
                                  onClick={() => handleAction(company, "suspend")}
                                  data-testid={`button-suspend-${company.id}`}
                                >
                                  <Ban className="w-4 h-4 mr-1" />
                                  Suspend
                                </Button>
                              )}
                              {company.status === "suspended" && (
                                <Button 
                                  size="sm" 
                                  onClick={() => handleAction(company, "approve")}
                                  data-testid={`button-reactivate-${company.id}`}
                                >
                                  Reactivate
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={dialogAction !== null} onOpenChange={() => { setDialogAction(null); setSelectedCompany(null); setSuspendReason(""); }}>
        <DialogContent data-testid="dialog-action">
          <DialogHeader>
            <DialogTitle>
              {dialogAction === "approve" && "Approve Company"}
              {dialogAction === "reject" && "Reject Company"}
              {dialogAction === "suspend" && "Suspend Company"}
            </DialogTitle>
            <DialogDescription>
              {dialogAction === "approve" && `Are you sure you want to approve "${selectedCompany?.name}"? They will be able to access the platform.`}
              {dialogAction === "reject" && `Are you sure you want to reject "${selectedCompany?.name}"? This action cannot be undone.`}
              {dialogAction === "suspend" && `Suspending "${selectedCompany?.name}" will disable their access to the platform.`}
            </DialogDescription>
          </DialogHeader>

          {dialogAction === "suspend" && (
            <div className="py-4">
              <Textarea
                placeholder="Enter reason for suspension (optional)"
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                data-testid="input-suspend-reason"
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogAction(null); setSelectedCompany(null); setSuspendReason(""); }} data-testid="button-cancel">
              Cancel
            </Button>
            <Button 
              variant={dialogAction === "approve" ? "default" : "destructive"}
              onClick={confirmAction}
              disabled={approveMutation.isPending || rejectMutation.isPending || suspendMutation.isPending}
              data-testid="button-confirm"
            >
              {(approveMutation.isPending || rejectMutation.isPending || suspendMutation.isPending) ? "Processing..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
