"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
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
import { useAdminMechanics } from "@/hooks/useAdminMechanics";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

export function AddMechanicDialog({ open, onOpenChange, onCreated }: Props) {
  const { createMechanic } = useAdminMechanics();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [timezone, setTimezone] = useState("America/Los_Angeles");
  const [radius, setRadius] = useState("30");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [specialties, setSpecialties] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setEmail("");
    setPhone("");
    setTimezone("America/Los_Angeles");
    setRadius("30");
    setLat("");
    setLng("");
    setSpecialties("");
    setError(null);
  }

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await createMechanic({
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        timezone: timezone.trim() || undefined,
        serviceRadiusMiles: radius ? Number(radius) : undefined,
        homeBaseLat: lat ? Number(lat) : undefined,
        homeBaseLng: lng ? Number(lng) : undefined,
        specialties: specialties
          ? specialties
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
      });
      reset();
      onOpenChange(false);
      onCreated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create mechanic");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Mechanic</DialogTitle>
          <DialogDescription>
            Create a mechanic record. Link them to a Supabase user later to
            grant login access.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="m-name">Name *</Label>
            <Input
              id="m-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="m-email">Email</Label>
              <Input
                id="m-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="m-phone">Phone</Label>
              <Input
                id="m-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="m-tz">Timezone</Label>
              <Input
                id="m-tz"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="m-radius">Service radius (miles)</Label>
              <Input
                id="m-radius"
                type="number"
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="m-lat">Home base latitude</Label>
              <Input
                id="m-lat"
                type="number"
                step="0.0000001"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="m-lng">Home base longitude</Label>
              <Input
                id="m-lng"
                type="number"
                step="0.0000001"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="m-spec">Specialties (comma-separated)</Label>
            <Input
              id="m-spec"
              value={specialties}
              onChange={(e) => setSpecialties(e.target.value)}
              placeholder="e.g. Brakes, Diagnostics"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create mechanic"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
