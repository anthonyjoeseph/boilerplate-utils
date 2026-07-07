import { Observable } from "rxjs";


export type DomActions = Observable<{ key: string; action: string }>;

// domActions -> domEvents
declare const applyDomActions: (allInputs: DomActions) => DomActions;