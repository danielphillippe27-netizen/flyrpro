"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";

import { useFailModal } from "@/lib/editor-canva/features/subscriptions/store/use-fail-modal";

import {
  Dialog,
  DialogTitle,
  DialogFooter,
  DialogHeader,
  DialogContent,
  DialogDescription,
} from "@/lib/editor-canva/components/ui/dialog";
import { Button } from "@/lib/editor-canva/components/ui/button";

export const FailModal = () => {
  const router = useRouter();
  const { isOpen, onClose } = useFailModal();

  const handleClose = () => {
    router.replace("/");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader className="flex items-center space-y-4">
          <Image
            src="/brand/wolfgrid-text-light.svg"
            alt="Logo"
            width={120}
            height={60}
            className="h-10 w-auto"
          />
          <DialogTitle className="text-center">
            Something went wrong
          </DialogTitle>
          <DialogDescription className="text-center">
            We could not process your payment
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="pt-2 mt-4 gap-y-2">
          <Button
            className="w-full"
            onClick={handleClose}
          >
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
