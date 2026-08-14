// A simple numbered-steps visual for pages that start on an empty "pick
// something" screen (Transfer Projection's initial search, Compare's player/
// team pickers) -- explains what has to happen next, and gives those short
// pages some real content instead of just a form, which also helps the
// sticky footer (see globals.css) land somewhere reasonable instead of
// right under a couple of search boxes.
export default function FlowSteps({ steps }: { steps: string[] }) {
  return (
    <div className="flow-steps">
      {steps.map((label, i) => (
        <div className="flow-step" key={i}>
          <div className="flow-step-inner">
            <div className="flow-step-num">{i + 1}</div>
            <div className="flow-step-label">{label}</div>
          </div>
          {i < steps.length - 1 && (
            <div className="flow-step-arrow" aria-hidden="true">
              &rarr;
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
