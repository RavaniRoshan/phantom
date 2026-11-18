/**
 * The OpenAPI document the `api` starter writes beside `blume.config.ts`, so a
 * new project's first build reads a local file instead of depending on a
 * third-party server. Small, but it exercises what a real reference renders:
 * path and query parameters, request bodies, shared schemas, error responses,
 * and bearer auth. Each operation's description is sized so its page's meta
 * description, with the endpoint sentence Blume appends, fits the range
 * `blume audit` checks.
 */

const petId = {
  description: "The pet's ID.",
  in: "path",
  name: "petId",
  required: true,
  schema: { type: "string" },
};

const errorResponse = (description: string) => ({
  content: {
    "application/json": { schema: { $ref: "#/components/schemas/Error" } },
  },
  description,
});

const petResponse = (description: string) => ({
  content: {
    "application/json": { schema: { $ref: "#/components/schemas/Pet" } },
  },
  description,
});

// Built from entries rather than a literal so the written file keeps the
// conventional section order (`openapi`, `info`, …) instead of the sorted one.
const STARTER_SPEC = Object.fromEntries([
  ["openapi", "3.1.0"],
  [
    "info",
    {
      description:
        "A small example API for a pet store: list, create, read, update, and delete pets. Replace openapi.json with your own spec to document your API.",
      title: "Pet Store API",
      version: "1.0.0",
    },
  ],
  ["servers", [{ url: "https://api.example.com/v1" }]],
  ["security", [{ bearerAuth: [] }]],
  [
    "tags",
    [
      {
        description:
          "Every pet in the store, with its name, species, and status.",
        name: "Pets",
      },
    ],
  ],
  [
    "paths",
    {
      "/pets": {
        get: {
          description:
            "Returns the pets in the store, newest first, filtered by status and paged with a cursor.",
          operationId: "listPets",
          parameters: [
            {
              description: "Only return pets with this status.",
              in: "query",
              name: "status",
              schema: { $ref: "#/components/schemas/Status" },
            },
            {
              description: "The most pets to return.",
              in: "query",
              name: "limit",
              schema: {
                default: 20,
                maximum: 100,
                minimum: 1,
                type: "integer",
              },
            },
            {
              description: "The `nextCursor` from the previous page.",
              in: "query",
              name: "cursor",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PetList" },
                },
              },
              description: "A page of pets.",
            },
          },
          summary: "List pets",
          tags: ["Pets"],
        },
        post: {
          description:
            "Adds a pet to the store and returns it with its new ID and an available status.",
          operationId: "createPet",
          requestBody: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/NewPet" },
              },
            },
            required: true,
          },
          responses: {
            "201": petResponse("The new pet."),
            "422": errorResponse("The pet's fields are invalid."),
          },
          summary: "Create a pet",
          tags: ["Pets"],
        },
      },
      "/pets/{petId}": {
        delete: {
          description:
            "Removes a pet from the store for good, or returns a 404 error when no pet has that ID.",
          operationId: "deletePet",
          parameters: [petId],
          responses: {
            "204": { description: "The pet was deleted." },
            "404": errorResponse("No pet has that ID."),
          },
          summary: "Delete a pet",
          tags: ["Pets"],
        },
        get: {
          description:
            "Returns a single pet by its ID, or a 404 error when no pet has that ID.",
          operationId: "getPet",
          parameters: [petId],
          responses: {
            "200": petResponse("The pet."),
            "404": errorResponse("No pet has that ID."),
          },
          summary: "Get a pet",
          tags: ["Pets"],
        },
        patch: {
          description:
            "Changes the fields you send on an existing pet and leaves the rest as they were.",
          operationId: "updatePet",
          parameters: [petId],
          requestBody: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PetUpdate" },
              },
            },
            required: true,
          },
          responses: {
            "200": petResponse("The updated pet."),
            "404": errorResponse("No pet has that ID."),
          },
          summary: "Update a pet",
          tags: ["Pets"],
        },
      },
    },
  ],
  [
    "components",
    {
      schemas: {
        Error: {
          properties: {
            code: { example: "not_found", type: "string" },
            message: { example: "No pet has that ID.", type: "string" },
          },
          required: ["code", "message"],
          type: "object",
        },
        NewPet: {
          properties: {
            name: { example: "Mochi", type: "string" },
            species: { $ref: "#/components/schemas/Species" },
          },
          required: ["name", "species"],
          type: "object",
        },
        Pet: {
          properties: {
            createdAt: { format: "date-time", type: "string" },
            id: { example: "pet_01h2x", type: "string" },
            name: { example: "Mochi", type: "string" },
            species: { $ref: "#/components/schemas/Species" },
            status: { $ref: "#/components/schemas/Status" },
          },
          required: ["id", "name", "species", "status", "createdAt"],
          type: "object",
        },
        PetList: {
          properties: {
            data: {
              items: { $ref: "#/components/schemas/Pet" },
              type: "array",
            },
            nextCursor: {
              description: "Pass as `cursor` to fetch the next page.",
              type: ["string", "null"],
            },
          },
          required: ["data", "nextCursor"],
          type: "object",
        },
        PetUpdate: {
          properties: {
            name: { type: "string" },
            status: { $ref: "#/components/schemas/Status" },
          },
          type: "object",
        },
        Species: { enum: ["cat", "dog", "bird", "rabbit"], type: "string" },
        Status: { enum: ["available", "pending", "adopted"], type: "string" },
      },
      securitySchemes: {
        bearerAuth: { scheme: "bearer", type: "http" },
      },
    },
  ],
]);

/** The starter spec as the `openapi.json` text `init` writes. */
export const STARTER_OPENAPI_JSON = `${JSON.stringify(STARTER_SPEC, null, 2)}\n`;
