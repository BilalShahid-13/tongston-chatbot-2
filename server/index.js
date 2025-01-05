import axios from "axios";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { OpenAI } from "openai";
import { config } from "dotenv";
import { prompts } from "./utils/prompts.js"; // Import prompt mappings

// Load environment variables
config();

// Initialize OpenAI API configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAPI_KEY, // Ensure this is set in your .env file
});

// Global user context
const userContext = {
  industry: "", // Store user's industry preference
};

// Initialize Express app
const app = express();
app.use(bodyParser.json());
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});

// Function to fetch file content from URL
const fetchFileContent = async (url) => {
  try {
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error(`Error fetching file from ${url}:`, error.message);
    return null;
  }
};

// Function to determine the relevant knowledge base file
const getKnowledgeBaseFilePath = (userQuery) => {
  if (!prompts) return null;
  const query = userQuery.toLowerCase();
  const matchedPrompt = prompts.find((prompt) =>
    prompt.tags.some((tag) => query.includes(tag))
  );
  return matchedPrompt ? matchedPrompt.knowledgeBase : null;
};

// Function to extract industry from the query
const extractIndustryFromQuery = (query) => {
  const industryPattern =
    /\b(?:in|for|about|related to|of the|within)\s([a-zA-Z\s]+?)(?:\sindustry|\ssector|$|,|\.)/i;
  const match = query.match(industryPattern);
  return match ? match[1].trim() : null;
};

// Function to ask OpenAI directly with streaming
const askOpenAI = async (userQuery, res) => {
  try {
    const prompt = `User's industry: ${
      userContext.industry || "not specified"
    }. Respond to the following query in the context of their industry: "${userQuery}"`;

    // Set headers for streaming
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Use a faster model
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
      stream: true, // Enable streaming
    });

    // Stream the response to the client
    for await (const chunk of response) {
      const content = chunk.choices[0]?.delta?.content || "";
      res.write(content);
    }

    res.end(); // End the stream
  } catch (error) {
    console.error("Error using OpenAI:", error.message);
    res.status(500).json({ response: "An error occurred. Please try again." });
  }
};

// Function to query OpenAI using knowledge base content with streaming
const askOpenAIWithTextContent = async (extractedText, userQuery, res) => {
  try {
    const prompt = `User's industry: ${
      userContext.industry || "not specified"
    }. Using the following knowledge base, provide a response to their query: "${userQuery}" --- ${extractedText.slice(
      0,
      4000
    )} --- Respond professionally and concisely.`;

    // Set headers for streaming
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Use a faster model
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
      stream: true, // Enable streaming
    });

    // Stream the response to the client
    for await (const chunk of response) {
      const content = chunk.choices[0]?.delta?.content || "";
      res.write(content);
    }

    res.end(); // End the stream
  } catch (error) {
    console.error("Error using OpenAI with text content:", error.message);
    res.status(500).json({ response: "An error occurred. Please try again." });
  }
};

// API endpoint to handle user queries
app.post("/ask", async (req, res) => {
  const { query, industry } = req.body;

  try {
    // Update the user's industry if provided
    if (industry) userContext.industry = industry.trim();

    // Extract industry from the query (if mentioned)
    const extractedIndustry = extractIndustryFromQuery(query);
    if (extractedIndustry) userContext.industry = extractedIndustry;

    const filePath = getKnowledgeBaseFilePath(query);
    if (filePath) {
      const extractedText = await fetchFileContent(filePath);
      if (extractedText) {
        await askOpenAIWithTextContent(extractedText, query, res);
      } else {
        res.json({ response: "Failed to fetch the knowledge base file." });
      }
    } else {
      await askOpenAI(query, res);
    }
  } catch (error) {
    console.error("Server error:", error.message);
    res.status(500).json({ response: "A server error has occurred." });
  }
});

app.get("/", (req, res) => {
  res.send("Hello from the server chatbot2!");
});

// Start the server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
