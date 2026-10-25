"use client";

import { useEffect, useState } from "react";

import { ChangePanel } from "@/components/change-panel";
import { ClassifyPanel } from "@/components/classify-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPercent } from "@/lib/landcover";
import { loadModel } from "@/lib/predict";

type ModelState =
  | { status: "loading"; accuracy: null; error: null }
  | { status: "ready"; accuracy: number; error: null }
  | { status: "error"; accuracy: null; error: string };

export function Lab() {
  const [model, setModel] = useState<ModelState>({ status: "loading", accuracy: null, error: null });
  const [tab, setTab] = useState("classify");

  useEffect(() => {
    let cancel = false;
    loadModel()
      .then((session) => {
        if (!cancel) setModel({ status: "ready", accuracy: session.manifest.testAccuracy, error: null });
      })
      .catch((reason: unknown) => {
        if (!cancel) {
          setModel({
            status: "error",
            accuracy: null,
            error: reason instanceof Error ? reason.message : "The land-cover weights did not load.",
          });
        }
      });
    return () => {
      cancel = true;
    };
  }, []);

  return (
    <section aria-labelledby="lab-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="lab-heading" className="font-heading text-3xl tracking-tight sm:text-4xl">
            The lab
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
            {model.status === "ready"
              ? `Weights are in the page. Held-out accuracy ${formatPercent(model.accuracy)}.`
              : model.status === "error"
                ? model.error
                : "Loading the land-cover weights into this browser."}
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList className="!h-auto w-full sm:w-fit">
          <TabsTrigger value="classify" className="!h-11 flex-1 px-3 sm:flex-none">
            Classify a chip
          </TabsTrigger>
          <TabsTrigger value="change" className="!h-11 flex-1 px-3 sm:flex-none">
            Two-year change
          </TabsTrigger>
        </TabsList>
        <TabsContent value="classify" className="pt-2" keepMounted>
          <ClassifyPanel ready={model.status === "ready"} />
        </TabsContent>
        <TabsContent value="change" className="pt-2" keepMounted>
          <ChangePanel ready={model.status === "ready"} active={tab === "change"} accuracy={model.accuracy} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
