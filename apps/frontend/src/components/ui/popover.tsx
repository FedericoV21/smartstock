"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "@/lib/utils";

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return (
    <PopoverPrimitive.Root modal={false} data-slot="popover" {...props} />
  );
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverPortal({ ...props }: PopoverPrimitive.Portal.Props) {
  return <PopoverPrimitive.Portal data-slot="popover-portal" {...props} />;
}

function PopoverPositioner({
  className,
  side = "bottom",
  align = "end",
  sideOffset = 6,
  collisionPadding = 12,
  ...props
}: PopoverPrimitive.Positioner.Props) {
  return (
    <PopoverPrimitive.Positioner
      data-slot="popover-positioner"
      className={cn("z-[100]", className)}
      side={side}
      align={align}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      {...props}
    />
  );
}

function PopoverPopup({
  className,
  ...props
}: PopoverPrimitive.Popup.Props) {
  return (
    <PopoverPrimitive.Popup
      data-slot="popover-popup"
      className={cn(
        "w-60 max-w-[min(18rem,calc(100vw-2rem))] rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-md outline-none ring-1 ring-foreground/8",
        className,
      )}
      {...props}
    />
  );
}

export { Popover, PopoverPortal, PopoverPopup, PopoverPositioner, PopoverTrigger };
