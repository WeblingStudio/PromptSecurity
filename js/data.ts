import _signaturePatterns from '../data/patterns.json';
import _semanticClusters from '../data/threats.json';
import _unicodeRanges from '../data/unicode.json';
import _ragConfig from '../data/rag.json';
import _modalityMap from '../data/modality.json';

export const signaturePatterns = _signaturePatterns as string[];

export const semanticClusters = _semanticClusters as { 
  tag: string; 
  samples: string[] 
}[];

export const ragConfig = _ragConfig as {
  imperative_words: string[];
  role_words: string[];
  semantic_probe: string;
};

export const unicodeRanges = _unicodeRanges as {
  hidden_ranges: [number, number][];
  homoglyph_blocks: [number, number][];
};

export const modalityMap = _modalityMap as {
  positive: string[];
  negative: string[];
};