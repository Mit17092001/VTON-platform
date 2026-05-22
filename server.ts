import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import * as fal from "@fal-ai/serverless-client";
import dotenv from "dotenv";

dotenv.config();

// Configure fal client with API key from environment
// Note: In a real app, you'd set this via process.env.FAL_KEY
// The aistudio environment handles this via .env
const falKey = process.env.FAL_KEY;

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Add JSON parsing middleware for larger payloads (images)
  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.post("/api/try-on", async (req, res) => {
    try {
      const { model_image, garment_image, category } = req.body;

      if (!falKey) {
        return res.status(401).json({ 
          error: "Missing FAL_KEY. Please set your Fal.ai API key in the environment variables." 
        });
      }

      // Initialize fal with the key
      // We use the proxy approach if possible, but here we can just pass the key to the request
      // since the client is running on the server.
      
      console.log("Triggering FLUX.1 VTON pipeline via Fal.ai...");

      // Explicitly configure Fal client with the loaded key
      if (falKey) {
        fal.config({
          credentials: falKey
        });
      }

      // Multi-model fallback strategy with expanded slugs
      // We'll try to find the correct Flux or high-quality VTON model
      // Schema for idm-vton confirmed to require: human_image_url, garment_image_url, description
      const models = [
        {
          id: "fal-ai/idm-vton",
          input: {
            human_image_url: model_image,
            garment_image_url: garment_image,
            description: category ? `${category} garment` : "stylish outfit",
            num_inference_steps: 30
          }
        },
        {
          id: "fal-ai/kolors-vton",
          input: {
            human_image_url: model_image,
            garment_image_url: garment_image,
          }
        },
        {
          id: "fal-ai/cat-vton",
          input: {
            human_image_url: model_image,
            garment_image_url: garment_image,
          }
        },
        {
          id: "fal-ai/flux-vton",
          input: {
            human_image_url: model_image,
            garment_image_url: garment_image,
            nsfw_filter: true
          }
        },
        {
          id: "fal-ai/fashn-vton",
          input: {
            human_image_url: model_image,
            garment_image_url: garment_image,
            category: category || "tops",
            restore_background: true
          }
        }
      ];

      let lastError = null;
      for (const model of models) {
        try {
          console.log(`Attempting model: ${model.id} via fal.run...`);
          
          // Using .run() as it's often more robust for serverless tasks
          // For longer tasks, fal.run handles the queue automatically
          const result: any = await fal.run(model.id, {
            input: model.input,
          });

          console.log(`Success with model: ${model.id}`);
          // Include model_id so the frontend knows which one succeeded
          return res.json({
            ...result,
            model_id: model.id
          });
        } catch (error: any) {
          const status = error.status || (error.message?.includes("Not Found") ? 404 : (error.message?.includes("Forbidden") ? 403 : (error.message?.includes("Unprocessable") ? 422 : 500)));
          console.warn(`Model ${model.id} failed (${status}):`, error.message);
          
          // If we get an error body, log it for more context
          if (error.body) console.log(`Error body for ${model.id}:`, JSON.stringify(error.body));
          
          lastError = error;
          
          // Try next model on not found, forbidden, or bad parameters (unprocessable)
          if (status === 404 || status === 403 || status === 422) {
            continue; 
          }
          throw error; 
        }
      }

      throw lastError || new Error("All models failed");
    } catch (error: any) {
      console.error("Fal.ai Flux error:", error);
      res.status(500).json({ error: error.message || "Internal Server Error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
