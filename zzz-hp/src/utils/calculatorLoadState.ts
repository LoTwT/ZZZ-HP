export type CalculatorLoadState = 'loading' | 'error' | 'ready'

export interface CalculatorLoadSnapshot {
  loading: boolean
  loaded: boolean
  error: string
}

export interface CalculatorDataLoader {
  loadAll(force?: boolean): Promise<void>
}

export function resolveCalculatorLoadState(snapshot: CalculatorLoadSnapshot): CalculatorLoadState {
  if (snapshot.loading) return 'loading'
  if (snapshot.error) return 'error'
  if (snapshot.loaded) return 'ready'
  return 'loading'
}

export function reloadCalculatorData(loader: CalculatorDataLoader): Promise<void> {
  return loader.loadAll(true)
}
