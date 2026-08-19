import { useState, useEffect, type ReactNode, createContext, useContext } from "react";

interface ModelNameContextValue {
  modelId: string;
  modelName: string;
}

const ModelNameContext = createContext<ModelNameContextValue>({
  modelId: "",
  modelName: "model",
});

export function ModelNameProvider({ modelId, modelName, children }: { modelId: string; modelName: string; children: ReactNode }) {
  const [state, setState] = useState<ModelNameContextValue>({ modelId, modelName });
  // Currently the model is baked into the build, so this is static.
  // Future: update from step.started events for dynamic model selection.
  useEffect(() => {
    setState({ modelId, modelName });
  }, [modelId, modelName]);

  return (
    <ModelNameContext.Provider value={state}>
      {children}
    </ModelNameContext.Provider>
  );
}

export function useModelName(): string {
  return useContext(ModelNameContext).modelName;
}

export function useModelId(): string {
  return useContext(ModelNameContext).modelId;
}
