import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../api/client";
import type { MrRequestView } from "../api/types";
import { mrNeedsApproval, mrStatusLabel } from "../lib/mr-request";

interface Props {
  taskId: string;
  mrRequest: MrRequestView;
}

export function MrRequestPanel({ taskId, mrRequest }: Props) {
  const queryClient = useQueryClient();
  const [mrTargetBranch, setMrTargetBranch] = useState(mrRequest.targetBranch || "main");
  const [summaryExpanded, setSummaryExpanded] = useState(false);

  useEffect(() => {
    setMrTargetBranch(mrRequest.targetBranch || "main");
    setSummaryExpanded(false);
  }, [taskId, mrRequest.targetBranch]);

  const approveMr = useMutation({
    mutationFn: () => api.approveMrRequest(taskId, { targetBranch: mrTargetBranch.trim() || undefined }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    },
  });

  const rejectMr = useMutation({
    mutationFn: () => api.rejectMrRequest(taskId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    },
  });

  const canApprove = mrRequest.status === "pending_approval" || mrRequest.status === "failed";
  const canReject = mrRequest.status === "pending_approval" || mrRequest.status === "blocked";
  const longSummary = mrRequest.summary.length > 220;

  return (
    <section className={`mr-panel mr-panel--${mrRequest.status}`} aria-label="Merge request">
      <div className="mr-panel-header">
        <span className={`mr-panel-status mr-panel-status--${mrRequest.status}`}>
          {mrStatusLabel(mrRequest.status)}
        </span>
        {mrNeedsApproval(mrRequest) ? (
          <span className="mr-panel-urgency">Operator action required</span>
        ) : null}
      </div>

      <h3 className="mr-panel-title">{mrRequest.title}</h3>

      <p className={`mr-panel-summary ${summaryExpanded ? "expanded" : ""}`}>{mrRequest.summary}</p>
      {longSummary ? (
        <button type="button" className="mr-panel-toggle" onClick={() => setSummaryExpanded((v) => !v)}>
          {summaryExpanded ? "Show less" : "Show full summary"}
        </button>
      ) : null}

      <dl className="mr-panel-meta">
        <div>
          <dt>Merge into</dt>
          <dd>
            {canApprove ? (
              <input
                className="mr-panel-branch-input"
                type="text"
                value={mrTargetBranch}
                onChange={(event) => setMrTargetBranch(event.target.value)}
                placeholder="main"
                aria-label="Target branch"
              />
            ) : (
              <code>{mrRequest.targetBranch}</code>
            )}
          </dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{mrRequest.draft ? "Draft MR" : "Merge request"}</dd>
        </div>
        {mrRequest.sourceBranch ? (
          <div>
            <dt>Source branch</dt>
            <dd>
              <code>{mrRequest.sourceBranch}</code>
            </dd>
          </div>
        ) : null}
        {mrRequest.patchArtifact ? (
          <div>
            <dt>Patch</dt>
            <dd>
              <code>{mrRequest.patchArtifact}</code>
            </dd>
          </div>
        ) : null}
        {mrRequest.bundleArtifact ? (
          <div>
            <dt>Bundle</dt>
            <dd>
              <code>{mrRequest.bundleArtifact}</code>
            </dd>
          </div>
        ) : null}
      </dl>

      {mrRequest.error ? <p className="mr-panel-error">{mrRequest.error}</p> : null}
      {approveMr.error ? <p className="mr-panel-error">{approveMr.error.message}</p> : null}

      <div className="mr-panel-actions">
        {canApprove ? (
          <button
            type="button"
            className="primary-button mr-panel-approve"
            disabled={approveMr.isPending}
            onClick={() => approveMr.mutate()}
          >
            {approveMr.isPending
              ? "Producing artifacts…"
              : mrRequest.status === "failed"
                ? "Retry promotion"
                : "Approve & produce git artifacts"}
          </button>
        ) : null}
        {canReject ? (
          <button
            type="button"
            className="secondary-button"
            disabled={rejectMr.isPending}
            onClick={() => rejectMr.mutate()}
          >
            {rejectMr.isPending ? "Rejecting…" : "Reject request"}
          </button>
        ) : null}
        {mrRequest.mrUrl ? (
          <a className="secondary-button mr-panel-link" href={mrRequest.mrUrl} target="_blank" rel="noreferrer">
            View promotion artifacts
          </a>
        ) : null}
      </div>
    </section>
  );
}
