// lib/googleGemini.ts
import { GoogleGenerativeAI } from "@google/generative-ai";

let genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.NANO_BANANA_API_KEY;
    
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set in environment variables");
    }
    
    genAI = new GoogleGenerativeAI(apiKey);
  }
  
  return genAI;
}

export function getGeminiModel(model: string) {
  return getGenAI().getGenerativeModel({ model });
}

