export interface SymbolicLatexSuccess {
  success: true;
  latex: string;
  envIndex: number;
}

export interface SymbolicLatexFailure {
  success: false;
  error: string;
  statusCode?: number;
}

export type SymbolicLatexResponse = SymbolicLatexSuccess | SymbolicLatexFailure;
