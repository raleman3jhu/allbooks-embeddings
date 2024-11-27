import clientPromise from './mongodb.js'
import OpenAI from 'openai'

//array of existing FAQs in drupal database
async function fetchFaqs() {
  const response = await fetch(
    'https://allbooks-help.press.jhu.edu/jsonapi/node/faq'
  )

  if (!response.ok) {
    throw new Error(`Response status: ${response.status}`)
  }

  const jsonResponse = await response.json()

  return jsonResponse.data
}

//takes in an faq item and generates an embedding from the field_question and field_questiontype values
export async function generateNewEmbedding(faqQuestion) {
  const openai = new OpenAI()
  const embedding = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: faqQuestion,
    encoding_format: 'float',
  })
  return embedding.data[0].embedding
}

export async function fetchSimilarDocs(
  questionEmbedding,
  numCandidates,
  limit
) {
  const client = await clientPromise
  const database = client.db('FAQs')
  const embeddingsCollection = database.collection('Embeddings')
  const similarDocs = await embeddingsCollection
    .aggregate([
      {
        $vectorSearch: {
          queryVector: questionEmbedding,
          path: 'embedding',
          numCandidates: numCandidates,
          limit: limit,
          index: 'vector_search',
        },
      },
      {
        $project: {
          Question: 1,
          Answer: 1,
        },
      },
    ])
    .toArray()
  return similarDocs
}

//another function compare faqs with embeddings and reconcile differences
export default async function reconcileEmbeddingsWithFaqs() {
  const faqs = await fetchFaqs()
  const client = await clientPromise

  const database = client.db('FAQs')
  const embeddingsCollection = database.collection('Embeddings')
  const cursor = embeddingsCollection.find()
  const existingEmbeddings = await cursor.toArray()

  //change to maps to reduce comparison time
  const faqsMap = new Map(
    faqs.map((faq) => [faq.attributes.field_idtopic, faq])
  )
  const embeddingsMap = new Map(
    existingEmbeddings.map((embedding) => [embedding.IDTopic, embedding])
  )

  //remove embeddings not present in FAQs
  for (const embedding of existingEmbeddings) {
    if (!faqsMap.has(embedding.IDTopic)) {
      await embeddingsCollection.deleteOne({ _id: embedding._id })
    }
  }

  //add or update embeddings based on FAQs
  for (const faq of faqs) {
    const existingEmbedding = embeddingsMap.get(faq.attributes.field_idtopic)

    if (
      !existingEmbedding ||
      existingEmbedding.Answer.value !=
        faq.attributes.field_rich_text_answer.value ||
      existingEmbedding.Question != faq.attributes.field_question
    ) {
      const { field_question, field_questiontype } = faq.attributes
      const formattedQuestionType = field_questiontype
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
      const faqQuestion = `${formattedQuestionType} ${field_question}?`

      const newEmbedding = await generateNewEmbedding(faqQuestion)

      const query = { IDTopic: faq.attributes.field_idtopic }
      const update = {
        $set: {
          IDTopic: faq.attributes.field_idtopic,
          Question: faq.attributes.field_question,
          Answer: faq.attributes.field_rich_text_answer,
          embedding: newEmbedding,
        },
      }
      const options = { upsert: true }

      await embeddingsCollection.updateOne(query, update, options)
    }
  }
}
