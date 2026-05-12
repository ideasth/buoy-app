// Stage 14b (2026-05-12) — Relationships settings UI.
//
// CRUD page for the relationships table that powers Reflect-mode coach
// prompts. Soft-delete only; hard delete is intentionally not exposed
// so historic coach session prompts remain reproducible.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface RelationshipRow {
  id: number;
  name: string;
  relationshipLabel: string;
  notes: string | null;
  active: number;
  displayOrder: number;
  userId: number | null;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse {
  relationships: RelationshipRow[];
}

const NAME_MAX = 80;
const LABEL_MAX = 80;
const NOTES_MAX = 500;

const RELATIONSHIPS_QUERY_KEY = "relationships";

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-AU", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

interface FormState {
  name: string;
  relationshipLabel: string;
  notes: string;
  displayOrder: string; // raw input string so users can clear it
  active: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  relationshipLabel: "",
  notes: "",
  displayOrder: "0",
  active: true,
};

interface DialogState {
  open: boolean;
  mode: "create" | "edit";
  row: RelationshipRow | null;
}

export default function Relationships() {
  const { toast } = useToast();
  const [showInactive, setShowInactive] = useState(false);
  const [dialog, setDialog] = useState<DialogState>({
    open: false,
    mode: "create",
    row: null,
  });
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const url = showInactive
    ? "/api/relationships?include_inactive=1"
    : "/api/relationships";
  const listQ = useQuery<ListResponse>({
    queryKey: [RELATIONSHIPS_QUERY_KEY, showInactive],
    queryFn: async () => {
      const res = await apiRequest("GET", url);
      return (await res.json()) as ListResponse;
    },
  });

  const rows = useMemo(() => {
    const list = listQ.data?.relationships ?? [];
    return [...list].sort((a, b) => {
      if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
      return a.id - b.id;
    });
  }, [listQ.data]);

  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: [RELATIONSHIPS_QUERY_KEY],
    });
  }

  const createM = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/relationships", body);
      return (await res.json()) as { relationship: RelationshipRow };
    },
    onSuccess: () => {
      invalidate();
      closeDialog();
      toast({ title: "Relationship added" });
    },
    onError: (err) => {
      toast({
        title: "Could not add relationship",
        description: String((err as Error).message ?? err),
        variant: "destructive",
      });
    },
  });

  const updateM = useMutation({
    mutationFn: async (args: { id: number; body: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/relationships/${args.id}`, args.body);
      return (await res.json()) as { relationship: RelationshipRow };
    },
    onSuccess: () => {
      invalidate();
      closeDialog();
      toast({ title: "Relationship updated" });
    },
    onError: (err) => {
      toast({
        title: "Could not update relationship",
        description: String((err as Error).message ?? err),
        variant: "destructive",
      });
    },
  });

  const softDeleteM = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/relationships/${id}`);
      return (await res.json()) as { relationship: RelationshipRow };
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Relationship hidden from prompts" });
    },
    onError: (err) => {
      toast({
        title: "Could not soft-delete relationship",
        description: String((err as Error).message ?? err),
        variant: "destructive",
      });
    },
  });

  const reactivateM = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/relationships/${id}`, {
        active: 1,
      });
      return (await res.json()) as { relationship: RelationshipRow };
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Relationship re-activated" });
    },
    onError: (err) => {
      toast({
        title: "Could not re-activate relationship",
        description: String((err as Error).message ?? err),
        variant: "destructive",
      });
    },
  });

  function openCreate() {
    setDialog({ open: true, mode: "create", row: null });
    setForm({ ...EMPTY_FORM });
    setErrors({});
  }
  function openEdit(row: RelationshipRow) {
    setDialog({ open: true, mode: "edit", row });
    setForm({
      name: row.name,
      relationshipLabel: row.relationshipLabel,
      notes: row.notes ?? "",
      displayOrder: String(row.displayOrder),
      active: row.active === 1,
    });
    setErrors({});
  }
  function closeDialog() {
    setDialog((d) => ({ ...d, open: false }));
  }

  // Reset form errors when the dialog opens.
  useEffect(() => {
    if (dialog.open) setErrors({});
  }, [dialog.open]);

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    const name = form.name.trim();
    const label = form.relationshipLabel.trim();
    if (!name) e.name = "Name is required.";
    else if (name.length > NAME_MAX)
      e.name = `Name must be ${NAME_MAX} characters or fewer.`;
    if (!label) e.relationshipLabel = "Relationship is required.";
    else if (label.length > LABEL_MAX)
      e.relationshipLabel = `Relationship must be ${LABEL_MAX} characters or fewer.`;
    if (form.notes.length > NOTES_MAX)
      e.notes = `Notes must be ${NOTES_MAX} characters or fewer.`;
    if (!/^-?\d+$/.test(form.displayOrder.trim()))
      e.displayOrder = "Display order must be a whole number.";
    return e;
  }

  function submit() {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      relationship_label: form.relationshipLabel.trim(),
      notes: form.notes.trim() ? form.notes : null,
      display_order: parseInt(form.displayOrder.trim(), 10),
      active: form.active ? 1 : 0,
    };
    if (dialog.mode === "create") {
      createM.mutate(body);
    } else if (dialog.row) {
      updateM.mutate({ id: dialog.row.id, body });
    }
  }

  const isEmpty = !listQ.isLoading && rows.length === 0;
  const submitting = createM.isPending || updateM.isPending;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Relationships</CardTitle>
            <CardDescription>
              Names the coach knows about. Soft-delete to hide a row from prompts without losing history.
            </CardDescription>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                id="show-inactive"
                checked={showInactive}
                onCheckedChange={setShowInactive}
                data-testid="switch-show-inactive"
              />
              <Label htmlFor="show-inactive" className="text-sm">
                Show inactive
              </Label>
            </div>
            <Button
              onClick={openCreate}
              size="sm"
              data-testid="button-add-relationship"
            >
              Add relationship
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {listQ.isLoading && (
            <div className="text-sm text-muted-foreground italic py-6 text-center">
              Loading…
            </div>
          )}
          {listQ.isError && (
            <div className="text-sm text-destructive py-6 text-center">
              Could not load relationships:{" "}
              {String((listQ.error as Error)?.message ?? "unknown error")}
            </div>
          )}
          {isEmpty && (
            <div className="text-sm text-muted-foreground italic py-8 text-center">
              No relationships yet. The coach prompt will omit the people section until you add some.
            </div>
          )}
          {!listQ.isLoading && rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Relationship</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Order</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-testid={`row-relationship-${row.id}`}
                    className={row.active === 0 ? "opacity-60" : undefined}
                  >
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.relationshipLabel}</TableCell>
                    <TableCell
                      className="text-sm text-muted-foreground max-w-xs"
                      title={row.notes ?? ""}
                    >
                      {row.notes ? truncate(row.notes, 60) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.displayOrder}
                    </TableCell>
                    <TableCell>
                      {row.active === 1 ? (
                        <Badge variant="default">Active</Badge>
                      ) : (
                        <Badge variant="outline">Hidden</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(row.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEdit(row)}
                        data-testid={`button-edit-${row.id}`}
                      >
                        Edit
                      </Button>
                      {row.active === 1 ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => softDeleteM.mutate(row.id)}
                          disabled={softDeleteM.isPending}
                          data-testid={`button-soft-delete-${row.id}`}
                        >
                          Soft delete
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => reactivateM.mutate(row.id)}
                          disabled={reactivateM.isPending}
                          data-testid={`button-reactivate-${row.id}`}
                        >
                          Re-activate
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={dialog.open}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog.mode === "create" ? "Add relationship" : "Edit relationship"}
            </DialogTitle>
            <DialogDescription>
              The coach will reference active rows by relationship label.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="rel-name">Name</Label>
              <Input
                id="rel-name"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                maxLength={NAME_MAX}
                autoFocus
                data-testid="input-name"
              />
              {errors.name && (
                <div className="text-xs text-destructive">{errors.name}</div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rel-label">Relationship</Label>
              <Input
                id="rel-label"
                placeholder="e.g. partner, daughter, colleague"
                value={form.relationshipLabel}
                onChange={(e) =>
                  setForm((f) => ({ ...f, relationshipLabel: e.target.value }))
                }
                maxLength={LABEL_MAX}
                data-testid="input-relationship-label"
              />
              {errors.relationshipLabel && (
                <div className="text-xs text-destructive">
                  {errors.relationshipLabel}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rel-notes">Notes</Label>
              <Textarea
                id="rel-notes"
                rows={3}
                placeholder="Optional context the coach can use."
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
                maxLength={NOTES_MAX}
                data-testid="input-notes"
              />
              <div className="text-[10px] text-muted-foreground">
                {form.notes.length}/{NOTES_MAX}
              </div>
              {errors.notes && (
                <div className="text-xs text-destructive">{errors.notes}</div>
              )}
            </div>
            <div className="flex items-end gap-4">
              <div className="space-y-1.5 flex-1">
                <Label htmlFor="rel-order">Display order</Label>
                <Input
                  id="rel-order"
                  type="number"
                  step="1"
                  value={form.displayOrder}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, displayOrder: e.target.value }))
                  }
                  data-testid="input-display-order"
                />
                {errors.displayOrder && (
                  <div className="text-xs text-destructive">
                    {errors.displayOrder}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 pb-2.5">
                <Switch
                  id="rel-active"
                  checked={form.active}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, active: !!v }))
                  }
                  data-testid="switch-active"
                />
                <Label htmlFor="rel-active" className="text-sm">
                  Active
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={closeDialog}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                data-testid="button-submit-relationship"
              >
                {submitting
                  ? "Saving…"
                  : dialog.mode === "create"
                    ? "Add"
                    : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
