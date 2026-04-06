import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  CheckCircle, XCircle, Ban, Clock, CreditCard, TrendingUp,
  Eye, Power, PowerOff, Search, Loader2, AlertTriangle, ClipboardList,
  CheckCircle2, UserCog
} from "lucide-react";

interface Company {
  id: string;
  name: string;
  slug: string;
  status: string;
  contactEmail: string | null;
  contactPhone: string | null;
  ownerUserId: string | null;
  planType: string | null;
  billingStatus: string | null;
  staffUserLimit: number | null;
  parentUserLimit: number | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  createdAt: string;
  isActive: boolean | null;
}

interface Stats {
  total: number;
  pending: number;
  approved: number;
  suspended: number;
  rejected: number;
  billingActive: number;
  billingPastDue: number;
  billingTrialing: number;
  billingNone: number;
}

const PLAN_PRICES: Record<string, number> = {
  starter: 29,
  professional: 49,
  enterprise: 99,
};

function statusBadge(status: string) {
  const config: Record<string, { bg: string; label: string }> = {
    pending_approval: { bg: "bg-yellow-100 text-yellow-800", label: "Pending" },
    approved: { bg: "bg-green-100 text-green-800", label: "Active" },
    suspended: { bg: "bg-red-100 text-red-800", label: "Suspended" },
    rejected: { bg: "bg-gray-100 text-gray-600", label: "Rejected" },
    cancelled: { bg: "bg-gray-100 text-gray-500", label: "Cancelled" },
  };
  const c = config[status] || { bg: "bg-gray-100 text-gray-800", label: status };
  return <Badge className={c.bg}>{c.label}</Badge>;
}

function CompanyCard({
  company,
  onApprove,
  onReject,
  onSuspend,
  onReactivate,
  onView,
  onImpersonate,
  isPending,
}: {
  company: Company;
  onApprove: () => void;
  onReject: () => void;
  onSuspend: () => void;
  onReactivate: () => void;
  onView: () => void;
  onImpersonate: () => void;
  isPending: boolean;
}) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-lg truncate">{company.name}</h3>
              {statusBadge(company.status)}
            </div>
            <p className="text-sm text-gray-500 truncate">{company.contactEmail || "No email"}</p>
            <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
              <span>/{company.slug}</span>
              <span>Plan: <span className="capitalize text-gray-600">{company.planType || "none"}</span></span>
              <span>Joined {new Date(company.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-4 pt-3 border-t">
          <Button variant="outline" size="sm" onClick={onView}>
            <Eye className="w-3.5 h-3.5 mr-1" /> Details
          </Button>

          {company.status === "approved" && (
            <Button
              variant="outline"
              size="sm"
              className="text-blue-600 border-blue-200 hover:bg-blue-50"
              onClick={onImpersonate}
            >
              <UserCog className="w-3.5 h-3.5 mr-1" /> Impersonate
            </Button>
          )}

          {company.status === "pending_approval" && (
            <>
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700"
                onClick={onApprove}
                disabled={isPending}
              >
                <CheckCircle className="w-3.5 h-3.5 mr-1" /> Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={onReject}
                disabled={isPending}
              >
                <XCircle className="w-3.5 h-3.5 mr-1" /> Deny
              </Button>
            </>
          )}

          {company.status === "approved" && (
            <Button
              size="sm"
              variant="outline"
              className="text-red-600 border-red-200 hover:bg-red-50"
              onClick={onSuspend}
            >
              <PowerOff className="w-3.5 h-3.5 mr-1" /> Deactivate
            </Button>
          )}

          {(company.status === "suspended" || company.status === "rejected") && (
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700"
              onClick={onReactivate}
              disabled={isPending}
            >
              <Power className="w-3.5 h-3.5 mr-1" /> Reactivate
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function MasterAdminPanel() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [innerTab, setInnerTab] = useState("pending");
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [suspendDialogOpen, setSuspendDialogOpen] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState<Company | null>(null);

  const { data: stats } = useQuery<Stats>({
    queryKey: ["/api/master-admin/stats"],
    queryFn: async () => {
      return await apiRequest("/api/master-admin/stats", "GET");
    },
  });

  const { data: companies = [], isLoading } = useQuery<Company[]>({
    queryKey: ["/api/master-admin/companies"],
    queryFn: async () => {
      return await apiRequest("/api/master-admin/companies", "GET");
    },
  });

  const estimatedMRR = useMemo(() => {
    return companies
      .filter((c) => c.billingStatus === "active" || c.status === "approved")
      .reduce((sum, c) => sum + (PLAN_PRICES[c.planType || ""] || 0), 0);
  }, [companies]);

  const filtered = useMemo(() => {
    let list = companies;

    // Filter by inner tab
    if (innerTab === "pending") {
      list = list.filter((c) => c.status === "pending_approval");
    } else if (innerTab === "paying") {
      list = list.filter((c) => c.billingStatus === "active" || (c.status === "approved" && c.billingStatus !== "past_due" && c.billingStatus !== "unpaid"));
    } else if (innerTab === "past-due") {
      list = list.filter((c) => c.billingStatus === "past_due" || c.billingStatus === "unpaid");
    }
    // "all" shows everything

    // Apply search
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      list = list.filter(
        (c) =>
          c.name?.toLowerCase().includes(term) ||
          c.contactEmail?.toLowerCase().includes(term) ||
          c.slug?.toLowerCase().includes(term)
      );
    }

    return list;
  }, [companies, innerTab, searchTerm]);

  const pendingCount = companies.filter((c) => c.status === "pending_approval").length;
  const payingCount = companies.filter(
    (c) => c.billingStatus === "active" || (c.status === "approved" && c.billingStatus !== "past_due" && c.billingStatus !== "unpaid")
  ).length;
  const pastDueCount = companies.filter(
    (c) => c.billingStatus === "past_due" || c.billingStatus === "unpaid"
  ).length;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/master-admin/companies"] });
    queryClient.invalidateQueries({ queryKey: ["/api/master-admin/stats"] });
  };

  const impersonateMutation = useMutation({
    mutationFn: async (companyId: string) => {
      return await apiRequest(`/api/master-admin/impersonate/${companyId}`, "POST");
    },
    onSuccess: (data: any) => {
      toast({
        title: "Impersonating Company",
        description: `Now viewing as ${data?.companyName || 'company'}. Redirecting...`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setTimeout(() => {
        window.location.href = "/";
      }, 1000);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to impersonate company.", variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (companyId: string) => {
      await apiRequest(`/api/master-admin/companies/${companyId}/approve`, "POST");
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Company Approved", description: "The company account has been activated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to approve company.", variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (companyId: string) => {
      await apiRequest(`/api/master-admin/companies/${companyId}/reject`, "POST");
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Company Rejected", description: "The application has been denied." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to reject company.", variant: "destructive" });
    },
  });

  const suspendMutation = useMutation({
    mutationFn: async ({ companyId, reason }: { companyId: string; reason: string }) => {
      await apiRequest(`/api/master-admin/companies/${companyId}/suspend`, "POST", { reason });
    },
    onSuccess: () => {
      invalidateAll();
      setSuspendDialogOpen(false);
      setSuspendReason("");
      setSuspendTarget(null);
      toast({ title: "Company Suspended", description: "The account has been deactivated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to suspend company.", variant: "destructive" });
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: async (companyId: string) => {
      await apiRequest(`/api/master-admin/companies/${companyId}/approve`, "POST");
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Company Reactivated", description: "The account has been reactivated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to reactivate.", variant: "destructive" });
    },
  });

  const anyPending =
    approveMutation.isPending || rejectMutation.isPending || reactivateMutation.isPending;

  const tabSectionTitle: Record<string, { title: string; desc: string }> = {
    pending: { title: "Pending Approvals", desc: "New business signups waiting for your review" },
    paying: { title: "Active Paying Customers", desc: "Companies with active subscriptions" },
    "past-due": { title: "Past Due / Unpaid", desc: "Companies with overdue or failed payments" },
    all: { title: "All Companies", desc: "Every company registered on the platform" },
  };

  return (
    <div className="space-y-6">
      {/* Row 1: Main Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Signups</p>
              <p className="text-3xl font-bold mt-1">{stats?.total || 0}</p>
            </div>
            <ClipboardList className="w-8 h-8 text-blue-400" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Pending Review</p>
              <p className="text-3xl font-bold mt-1 text-yellow-600">{stats?.pending || 0}</p>
            </div>
            <Clock className="w-8 h-8 text-yellow-400" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Active Paying</p>
              <p className="text-3xl font-bold mt-1 text-green-600">{stats?.billingActive || payingCount}</p>
            </div>
            <CreditCard className="w-8 h-8 text-green-400" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Est. MRR</p>
              <p className="text-3xl font-bold mt-1 text-purple-600">${estimatedMRR}</p>
            </div>
            <TrendingUp className="w-8 h-8 text-purple-400" />
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Status Breakdown */}
      <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
        <Card className="bg-gray-50">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-gray-500">Approved</p>
            <p className="text-xl font-bold text-green-600 mt-1">{stats?.approved || 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-gray-50">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-gray-500">Suspended</p>
            <p className="text-xl font-bold text-red-500 mt-1">{stats?.suspended || 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-gray-50">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-gray-500">Past Due</p>
            <p className="text-xl font-bold text-orange-500 mt-1">{stats?.billingPastDue || 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-gray-50">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-gray-500">Trialing</p>
            <p className="text-xl font-bold mt-1">{stats?.billingTrialing || 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-gray-50">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-gray-500">No Payment</p>
            <p className="text-xl font-bold text-gray-400 mt-1">{stats?.billingNone || 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          placeholder="Search by company name, email, or slug..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Inner Tabs */}
      <Tabs value={innerTab} onValueChange={setInnerTab}>
        <TabsList>
          <TabsTrigger value="pending">Pending ({pendingCount})</TabsTrigger>
          <TabsTrigger value="paying">Paying ({payingCount})</TabsTrigger>
          <TabsTrigger value="past-due">Past Due / Unpaid ({pastDueCount})</TabsTrigger>
          <TabsTrigger value="all">All Companies ({companies.length})</TabsTrigger>
        </TabsList>

        {["pending", "paying", "past-due", "all"].map((tab) => (
          <TabsContent key={tab} value={tab}>
            <Card>
              <CardHeader>
                <CardTitle>{tabSectionTitle[tab].title}</CardTitle>
                <CardDescription>{tabSectionTitle[tab].desc}</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin mr-2" />
                    Loading...
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                    <CheckCircle2 className="w-12 h-12 mb-3 opacity-40" />
                    <p>No {tab === "pending" ? "pending approval requests" : "companies found"}</p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {filtered.map((company) => (
                      <CompanyCard
                        key={company.id}
                        company={company}
                        onApprove={() => approveMutation.mutate(company.id)}
                        onReject={() => rejectMutation.mutate(company.id)}
                        onSuspend={() => {
                          setSuspendTarget(company);
                          setSuspendDialogOpen(true);
                        }}
                        onReactivate={() => reactivateMutation.mutate(company.id)}
                        onView={() => {
                          setSelectedCompany(company);
                          setDetailsOpen(true);
                        }}
                        onImpersonate={() => impersonateMutation.mutate(company.id)}
                        isPending={anyPending}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {/* Company Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Company Details</DialogTitle>
          </DialogHeader>
          {selectedCompany && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Name</p>
                  <p className="font-medium">{selectedCompany.name}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  {statusBadge(selectedCompany.status)}
                </div>
                <div>
                  <p className="text-sm text-gray-500">Email</p>
                  <p className="text-sm">{selectedCompany.contactEmail || "—"}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Phone</p>
                  <p className="text-sm">{selectedCompany.contactPhone || "—"}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Plan</p>
                  <Badge variant="outline" className="capitalize">{selectedCompany.planType || "none"}</Badge>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Billing</p>
                  <Badge variant="outline" className="capitalize">{selectedCompany.billingStatus || "none"}</Badge>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Staff Limit</p>
                  <p className="text-sm">{selectedCompany.staffUserLimit ?? "Unlimited"}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Parent Limit</p>
                  <p className="text-sm">{selectedCompany.parentUserLimit ?? "Unlimited"}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Created</p>
                  <p className="text-sm">{new Date(selectedCompany.createdAt).toLocaleString()}</p>
                </div>
                {selectedCompany.approvedAt && (
                  <div>
                    <p className="text-sm text-gray-500">Approved</p>
                    <p className="text-sm">{new Date(selectedCompany.approvedAt).toLocaleString()}</p>
                  </div>
                )}
                {selectedCompany.suspensionReason && (
                  <div className="col-span-2">
                    <p className="text-sm text-gray-500">Suspension Reason</p>
                    <p className="text-sm text-red-600">{selectedCompany.suspensionReason}</p>
                  </div>
                )}
              </div>

              <div className="border-t pt-4 flex gap-2 justify-end">
                {selectedCompany.status === "pending_approval" && (
                  <>
                    <Button
                      className="bg-green-600 hover:bg-green-700"
                      onClick={() => { approveMutation.mutate(selectedCompany.id); setDetailsOpen(false); }}
                    >
                      <CheckCircle className="w-4 h-4 mr-1" /> Approve
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => { rejectMutation.mutate(selectedCompany.id); setDetailsOpen(false); }}
                    >
                      <XCircle className="w-4 h-4 mr-1" /> Deny
                    </Button>
                  </>
                )}
                {selectedCompany.status === "approved" && (
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setSuspendTarget(selectedCompany);
                      setSuspendDialogOpen(true);
                      setDetailsOpen(false);
                    }}
                  >
                    <PowerOff className="w-4 h-4 mr-1" /> Deactivate
                  </Button>
                )}
                {(selectedCompany.status === "suspended" || selectedCompany.status === "rejected") && (
                  <Button
                    className="bg-green-600 hover:bg-green-700"
                    onClick={() => { reactivateMutation.mutate(selectedCompany.id); setDetailsOpen(false); }}
                  >
                    <Power className="w-4 h-4 mr-1" /> Reactivate
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Suspend Confirmation Dialog */}
      <Dialog open={suspendDialogOpen} onOpenChange={setSuspendDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center text-red-600">
              <AlertTriangle className="w-5 h-5 mr-2" />
              Suspend Company
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              You are about to deactivate <strong>{suspendTarget?.name}</strong>. This will disable their access to the platform.
            </p>
            <div>
              <label className="text-sm font-medium">Reason for suspension</label>
              <Textarea
                placeholder="Enter the reason for suspending this account..."
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setSuspendDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={!suspendReason.trim() || suspendMutation.isPending}
                onClick={() => {
                  if (suspendTarget) {
                    suspendMutation.mutate({ companyId: suspendTarget.id, reason: suspendReason });
                  }
                }}
              >
                {suspendMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                ) : (
                  <Ban className="w-4 h-4 mr-1" />
                )}
                Confirm Suspension
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
