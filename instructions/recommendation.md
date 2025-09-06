## Objective

Enable users to describe clothing they want in natural language (e.g., “a slim-fit black turtleneck sweater for winter”) and return 10 real lay-flat product images from popular brands. These can then be used with the existing virtual try-on editor.

## User Flow
1. User enters a free-text clothing description.
2. System parses intent (category, style, color, fit, seasonality, etc.).
3. Query mapped to product database / external API of lay-flat images.
4. Return 10 relevant, real clothing images.
5. User selects one to use in the try-on editor.

## Core Components
1. **Input Layer**
   - Text input box (front-end).
   - Send raw query to backend for parsing.
   
2. **Natural Language Parsing**
   - Use an NLP model (LLM or fine-tuned classifier) to extract structured attributes:
     - **Category** (shirt, jeans, dress, jacket, etc.)
     - **Style** (casual, formal, oversized, slim-fit, etc.)
     - **Color / pattern** (black, striped, floral, etc.)
     - **Material** (cotton, denim, silk, etc.) – optional in MVP
     - **Seasonality** (winter coat, summer dress, etc.) – optional in MVP

3. **Search & Retrieval**
   - Map structured attributes to product database or API.
   - Use vector search (semantic embeddings) for fuzzy matching.
   - Apply filters (category + color at minimum).
   - Return top 10 lay-flat clothing images with metadata (brand, product name, URL).

4. **Results Display**
   - Grid of 10 product images.
   - Metadata: brand + item name.
   - “Use in Try-On” button to send selected garment to existing editor.

## Example API Endpoint
```
GET https://serpapi.com/search.json?engine=google_images&q=<query>&api_key=<YOUR_API_KEY>
```
-  **engine**: google_images
-  **q**: <natural language query or parsed attributes (e.g., "black slim-fit turtleneck sweater lay-flat")>
-  **api_key**: <your SerpApi key>

### JSON Response Structure (Key Fields)
Each result in `shopping_results[]` contains:
-  **title** (product name)
-  **thumbnail** (image URL)
-  **link** (product page)
-  **source** (brand/store)
-  **price**, **extracted_price** (where available)
-  **extensions** (may include “lay flat”/“flat lay” or similar if Google shows it)
-  **position** (result order)

## Implementation Steps
1. **Input Layer**
   - React input box captures free text.
   - Send to backend.

2. **NLP Parsing**
   - Use OpenAI or similar to extract:
     - Category, Style, Color, Fit, Seasonality (optional: Material).
   - Construct search query, e.g.:
     - "lay-flat slim-fit black turtleneck sweater winter"

3. **API Search & Retrieval**
   - Call SerpApi with constructed query as above.
   - Filter results by:
     - Image type (prefer genuine photos; reject obvious AI/artwork).
     - Use product metadata for brand preferences.
     - Lay-flat appearance by keyword, metadata, or visual rating (future: consider simple ML filter for flat-lay detection).
   - Return top 10 shopping_results.

4. **Display & Selection**
   - Show images in a 2x5 grid.
   - Display: image, brand (source), product name (title), “Use in Try-On” button.
   - On selection: pass product/image to the try-on editor.

## Data Source Constraints
-  Only real (not AI-generated) product images.
-  Limit: 10 images/query.
-  Brands = use source field (e.g., “Nike”, “Uniqlo”, etc.).

## Technical Stack
-  **Frontend**: React (extend your try-on UI).
-  **Backend**: Node.js or Python service to handle query processing and API calls.
-  **NLP**: OpenAI embeddings + attribute rules.
-  **Search**: Optionally vector-search parsed data for fuzzy matching.
-  **Storage**: Postgres for metadata cache.
-  **API/External**: SerpApi for on-demand product image retrieval.

