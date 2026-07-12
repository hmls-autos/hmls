"use client";

import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useMechanicOverrides } from "@/hooks/useMechanic";

export default function TimeOffPage() {
  // Show overrides from today to 90 days out
  const { from, to } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setDate(end.getDate() + 90);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return { from: fmt(today), to: fmt(end) };
  }, []);

  const { overrides, isLoading, addOverride, deleteOverride } =
    useMechanicOverrides(from, to);

  const [date, setDate] = useState(from);
  const [reason, setReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!date) {
      setError("Pick a date");
      return;
    }
    try {
      setIsSaving(true);
      setError(null);
      await addOverride({
        overrideDate: date,
        isAvailable: false,
        reason: reason.trim() || undefined,
      });
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const dayOffs = overrides.filter((o) => !o.isAvailable);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">
          Time Off
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Block specific days (e.g. vacation, sick day). Overrides your weekly
          hours.
        </p>
      </div>

      <Card className="border-0">
        <CardContent className="p-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            Add a day off
          </h2>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="date"
              value={date}
              min={from}
              onChange={(e) => setDate(e.target.value)}
              className="border border-border rounded-md px-2 py-1.5 text-sm bg-background"
            />
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={1}
              placeholder="Reason (optional)"
              className="resize-none flex-1"
            />
            <Button onClick={handleAdd} disabled={isSaving}>
              {isSaving ? "Saving..." : "Block day"}
            </Button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>

      <section>
        <h2 className="text-sm font-semibold text-foreground mb-3">
          Upcoming days off ({dayOffs.length})
        </h2>
        {dayOffs.length === 0 ? (
          <p className="text-sm text-muted-foreground">None scheduled.</p>
        ) : (
          <div className="space-y-2">
            {dayOffs.map((o) => (
              <Card key={o.id} className="border-0 py-0">
                <CardContent className="p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {o.overrideDate}
                    </p>
                    {o.reason && (
                      <p className="text-xs text-muted-foreground truncate">
                        {o.reason}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      try {
                        await deleteOverride(o.id);
                      } catch (e) {
                        toast.error(
                          e instanceof Error
                            ? e.message
                            : "Failed to delete override",
                        );
                      }
                    }}
                    className="text-muted-foreground hover:text-red-500"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
