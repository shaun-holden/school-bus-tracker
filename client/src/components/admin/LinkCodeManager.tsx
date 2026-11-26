import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Copy, RefreshCw, Trash2, Link, Users, Key, Clock, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { splitLinkCodes } from "@/lib/linkCodes";

interface Student {
  id: string;
  firstName: string;
  lastName: string;
  grade?: string;
}

interface LinkCode {
  id: string;
  code: string;
  studentId: string;
  status: 'active' | 'used' | 'expired' | 'revoked';
  maxUses: number;
  usesCount: number;
  expiresAt: string;
  createdAt: string;
}

interface LinkedParent {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

// Q169: the number boxes keep the typed text; it is turned into a number only
// here, when generating. A whole number in [min, max], else null (never clamped).
function parseBoxedInt(text: string, min: number, max: number): number | null {
  const t = text.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

interface LinkCodeManagerProps {
  student: Student;
  onClose?: () => void;
}

export function LinkCodeManager({ student, onClose }: LinkCodeManagerProps) {
  const { toast } = useToast();
  const [maxUsesText, setMaxUsesText] = useState("2");
  const [expiresInDaysText, setExpiresInDaysText] = useState("7");
  const [showOldCodes, setShowOldCodes] = useState(false);
  const maxUses = parseBoxedInt(maxUsesText, 1, 5);
  const expiresInDays = parseBoxedInt(expiresInDaysText, 1, 30);
  const inputsValid = maxUses !== null && expiresInDays !== null;

  const { data: linkCodes, isLoading: loadingCodes } = useQuery<LinkCode[]>({
    queryKey: ['/api/students', student.id, 'link-codes'],
  });

  const { data: linkedParents, isLoading: loadingParents } = useQuery<LinkedParent[]>({
    queryKey: ['/api/students', student.id, 'linked-parents'],
  });

  const generateCodeMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('/api/link-codes', 'POST', { studentId: student.id, maxUses, expiresInDays });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/students', student.id, 'link-codes'] });
      toast({ title: "Link code generated successfully" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to generate link code", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const regenerateCodeMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/students/${student.id}/regenerate-code`, 'POST');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/students', student.id, 'link-codes'] });
      toast({ title: "Link code regenerated - old codes revoked" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to regenerate link code", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const revokeCodeMutation = useMutation({
    mutationFn: async (codeId: string) => {
      return await apiRequest(`/api/link-codes/${codeId}`, 'DELETE');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/students', student.id, 'link-codes'] });
      toast({ title: "Link code revoked" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to revoke link code", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const unlinkParentMutation = useMutation({
    mutationFn: async (parentId: string) => {
      return await apiRequest(`/api/students/${student.id}/parents/${parentId}`, 'DELETE');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/students', student.id, 'linked-parents'] });
      toast({ title: "Parent unlinked successfully" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to unlink parent", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code);
    toast({ title: "Code copied to clipboard" });
  };

  const getStatusBadge = (status: string, expiresAt: string) => {
    const isExpired = new Date(expiresAt) < new Date();
    if (isExpired && status === 'active') {
      return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" /> Expired</Badge>;
    }
    switch (status) {
      case 'active':
        return <Badge variant="default"><CheckCircle2 className="w-3 h-3 mr-1" /> Active</Badge>;
      case 'used':
        return <Badge variant="secondary"><AlertCircle className="w-3 h-3 mr-1" /> Fully Used</Badge>;
      case 'expired':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" /> Expired</Badge>;
      case 'revoked':
        return <Badge variant="outline"><XCircle className="w-3 h-3 mr-1" /> Revoked</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // Q185/Q188: current codes vs old ones (revoked, used, expired); old ones fold under a toggle
  const { active: activeCodes, old: oldCodes } = splitLinkCodes(linkCodes ?? []);
  const hasActiveCode = activeCodes.length > 0;

  const renderCodeTable = (codes: LinkCode[], testId: string) => (
    <Table data-testid={testId}>
      <TableHeader>
        <TableRow>
          <TableHead>Code</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Uses</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {codes.map((code) => (
          <TableRow key={code.id}>
            <TableCell>
              <code className="font-mono text-base sm:text-lg font-bold text-orange-600 bg-orange-50 px-3 py-1 rounded">
                {code.code}
              </code>
            </TableCell>
            <TableCell>
              {getStatusBadge(code.status, code.expiresAt)}
            </TableCell>
            <TableCell>
              {code.usesCount} / {code.maxUses}
            </TableCell>
            <TableCell>
              <div className="flex items-center space-x-1 text-sm text-muted-foreground">
                <Clock className="w-3 h-3" />
                <span>{format(new Date(code.expiresAt), 'MMM d, yyyy')}</span>
              </div>
            </TableCell>
            <TableCell>
              <div className="flex space-x-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(code.code)}
                  data-testid={`button-copy-code-${code.id}`}
                >
                  <Copy className="w-4 h-4" />
                </Button>
                {code.status === 'active' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => revokeCodeMutation.mutate(code.id)}
                    disabled={revokeCodeMutation.isPending}
                    className="text-red-500 hover:text-red-700"
                    data-testid={`button-revoke-code-${code.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <div className="p-3 bg-orange-100 rounded-full">
          <Key className="w-6 h-6 text-orange-600" />
        </div>
        <div>
          <h3 className="font-semibold text-lg">
            {student.firstName} {student.lastName}
          </h3>
          <p className="text-sm text-muted-foreground">
            {student.grade ? `Grade ${student.grade}` : 'No grade assigned'}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center space-x-2">
            <Link className="w-4 h-4" />
            <span>Link Codes</span>
          </CardTitle>
          <CardDescription>
            Generate codes for parents/guardians to link to this child's account
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasActiveCode && (
            <div className="space-y-2">
              {/* Q183: the row wraps on phones; the hint sits on its own line below it */}
              <div className="flex flex-wrap items-end gap-4 p-4 bg-muted rounded-lg" data-testid="row-generate-link-code">
                <div className="space-y-2">
                  <Label>Max Uses</Label>
                  <Input 
                    type="number" 
                    value={maxUsesText} 
                    onChange={(e) => setMaxUsesText(e.target.value)}
                    onBlur={() => { if (maxUsesText.trim() === "") setMaxUsesText("2"); }}
                    min={1}
                    max={5}
                    className="w-20"
                    data-testid="input-max-uses"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Expires In (Days)</Label>
                  <Input 
                    type="number" 
                    value={expiresInDaysText} 
                    onChange={(e) => setExpiresInDaysText(e.target.value)}
                    onBlur={() => { if (expiresInDaysText.trim() === "") setExpiresInDaysText("7"); }}
                    min={1}
                    max={30}
                    className="w-20"
                    data-testid="input-expires-days"
                  />
                </div>
                <Button 
                  onClick={() => { if (inputsValid) generateCodeMutation.mutate(); }}
                  disabled={generateCodeMutation.isPending || !inputsValid}
                  data-testid="button-generate-code"
                >
                  {generateCodeMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Key className="w-4 h-4 mr-2" />
                  )}
                  Generate Code
                </Button>
              </div>
              {!inputsValid && (
                <p className="text-sm text-destructive" data-testid="text-link-code-input-hint">
                  Max uses must be 1 to 5 and days 1 to 30.
                </p>
              )}
            </div>
          )}

          {loadingCodes ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : (
            <>
              {activeCodes.length > 0 ? (
                renderCodeTable(activeCodes, "table-active-codes")
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  {oldCodes.length > 0 ? "No active code. Generate one above." : "No link codes generated yet"}
                </div>
              )}
              {oldCodes.length > 0 && (
                <div className="space-y-2">
                  <Button
                    variant="link"
                    size="sm"
                    className="px-0"
                    onClick={() => setShowOldCodes((v) => !v)}
                    data-testid="button-toggle-old-codes"
                  >
                    {showOldCodes ? "Hide old codes" : `Show old codes (${oldCodes.length})`}
                  </Button>
                  {showOldCodes && renderCodeTable(oldCodes, "table-old-codes")}
                </div>
              )}
            </>
          )}

          {hasActiveCode && (
            <Button
              variant="outline"
              onClick={() => regenerateCodeMutation.mutate()}
              disabled={regenerateCodeMutation.isPending}
              data-testid="button-regenerate-code"
            >
              {regenerateCodeMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Regenerate Code (Revokes Old)
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center space-x-2">
            <Users className="w-4 h-4" />
            <span>Linked Parents/Guardians</span>
          </CardTitle>
          <CardDescription>
            Parents who have linked to this child using a code
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingParents ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : linkedParents && linkedParents.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linkedParents.map((parent) => (
                  <TableRow key={parent.id}>
                    <TableCell className="font-medium">
                      {parent.firstName || parent.lastName 
                        ? `${parent.firstName || ''} ${parent.lastName || ''}`.trim()
                        : 'No name provided'}
                    </TableCell>
                    <TableCell>{parent.email || 'No email'}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => unlinkParentMutation.mutate(parent.id)}
                        disabled={unlinkParentMutation.isPending}
                        className="text-red-500 hover:text-red-700"
                        data-testid={`button-unlink-parent-${parent.id}`}
                      >
                        {unlinkParentMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <Trash2 className="w-4 h-4 mr-1" />
                            Unlink
                          </>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              No parents linked yet. Share a link code with parents to connect them.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function LinkCodeButton({ student }: { student: Student }) {
  const [open, setOpen] = useState(false);
  
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          size="sm"
          aria-label="Link code"
          data-testid={`button-manage-link-${student.id}`}
        >
          <Link className="w-4 h-4 mr-1" />
          <span>Link code</span>
        </Button>
      </DialogTrigger>
      {/* Q183: side gap on phones, local to this dialog */}
      <DialogContent className="w-[calc(100%-2rem)] max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Parent Linking</DialogTitle>
          <DialogDescription>
            Manage parent/guardian links for this student
          </DialogDescription>
        </DialogHeader>
        <LinkCodeManager student={student} onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
