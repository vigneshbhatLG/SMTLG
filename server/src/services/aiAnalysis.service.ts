import { getMongoDb } from '../utils/mongo';


export interface AIAnalysisRequest {
    issueId: string;
    summary: string;
    description: string;
}

export interface SimilarIssue {
    issue_id: string;
    likely_cause: string;
    distance: number;
}

export interface AIAnalysisResponse {
    "Issue ID": string;
    issue_link: string;
    predicted_issue_id: string;
    predicted_category: string;
    likely_cause: string;
    suggested_fix: string;
    confidence_score: number;
    similar_issues: SimilarIssue[];
    explanation: string;
    recommended_fix: string;
}
const AI_SERVICE_URL = 'http://10.221.96.182:8000';

export class AIAnalysisService {
    /**
     * Perform AI analysis on a single issue
     * Fetches issue from MongoDB issueAnalysis collection using ticketId and sends to AI service
     * @param ticketId - The ticket ID to analyze
     * @returns Analysis result for the single issue
     */
    async analyzeIssue(ticketId: string): Promise<AIAnalysisResponse | null> {
        try {
            // Fetch single issue from issueAnalysis collection
            const issue = await this.fetchIssueFromDB(ticketId);

            if (!issue) {
                console.log('Issue not found in issueAnalysis collection for ticketId:', ticketId);
                return null;
            }

            // Format issue for AI service
            const aiRequestBody = {
                issue_ID: issue.ticketId,
                summary: issue.summary,
                description: issue.description
            };

            console.log(`Sending issue ${issue.ticketId} to AI service`);

            // Call the AI service with the single issue
            const aiResult = await this.callAIService(aiRequestBody);

            // Map result back to analysis format
            const analysisResult = this.mapAIResponseToAnalysis(issue.ticketId, aiResult);
            console.log('Analysis result for issue', ticketId, ':', analysisResult);

            // Save analysis result back to MongoDB for only this issue
            await this.saveAnalysisResult(analysisResult);

            // Return only the single analysis result
            return analysisResult;
        } catch (error) {
            throw new Error(`Failed to analyze issue: ${(error as Error).message}`);
        }
    }

    /**
     * Streaming bulk analysis — only processes the given ticketIds.
     * Calls onProgress after each issue completes.
     */
    async analyzeBulkStreaming(
        ticketIds: string[],
        onProgress: (event: { done: number; total: number; result: AIAnalysisResponse | null; error?: string }) => void
    ): Promise<void> {
        const db = getMongoDb();
        const collection = db.collection('issueAnalysis');

        // Fetch only the requested issues
        const issues = await collection.find({ ticketId: { $in: ticketIds } }).toArray();

        if (!issues || issues.length === 0) {
            onProgress({ done: 0, total: 0, result: null });
            return;
        }

        const total = issues.length;
        console.log(`[AI BULK] Starting streaming analysis for ${total} issues`);

        for (let i = 0; i < issues.length; i++) {
            const issue = issues[i];
            try {
                const aiRequestBody = {
                    issue_ID: issue.ticketId,
                    summary: issue.summary,
                    description: issue.description
                };

                const aiResult = await this.callAIService(aiRequestBody);
                const analysisResult = this.mapAIResponseToAnalysis(issue.ticketId, aiResult);
                await this.saveAnalysisResult(analysisResult);

                onProgress({ done: i + 1, total, result: analysisResult });
                console.log(`[AI BULK] ${i + 1}/${total} — ${issue.ticketId}`);
            } catch (err: any) {
                console.error(`[AI BULK] Failed for ${issue.ticketId}:`, err.message);
                onProgress({ done: i + 1, total, result: null, error: issue.ticketId });
            }
        }
    }

    /**
     * Load saved analysis results from MongoDB for the given ticketIds.
     * Used on page load to restore previously analyzed data.
     */
    async getAnalysisResults(ticketIds: string[]): Promise<Array<{ ticketId: string; analysisResult: AIAnalysisResponse }>> {
        try {
            const db = getMongoDb();
            const docs = await db.collection('issueAnalysis').find(
                { ticketId: { $in: ticketIds }, analysisCompleted: true },
                { projection: { ticketId: 1, analysisResult: 1 } }
            ).toArray();

            return docs.map((d: any) => ({ ticketId: d.ticketId, analysisResult: d.analysisResult }));
        } catch (error) {
            console.error('Error fetching analysis results:', error);
            return [];
        }
    }

    /**
     * Perform bulk AI analysis on multiple issues from MongoDB issueAnalysis collection
     * @returns Array of AI analysis results
     */
    async analyzeBulkFromDB(): Promise<AIAnalysisResponse[]> {
        try {
            const issues = await this.fetchIssuesFromDB();

            if (!issues || issues.length === 0) {
                console.log('No issues found in issueAnalysis collection');
                return [];
            }

            const aiRequestBody = issues.map((issue: any) => ({
                issue_ID: issue.ticketId,
                summary: issue.summary,
                description: issue.description
            }));

            console.log(`Sending ${aiRequestBody.length} issues to AI service`);

            const aiResults = await this.callAIServiceBulk(aiRequestBody);

            const analysisResults = aiResults.map((result: any, index: number) =>
                this.mapAIResponseToAnalysis(issues[index].ticketId, result)
            );

            return analysisResults;
        } catch (error) {
            throw new Error(`Failed to perform bulk analysis: ${(error as Error).message}`);
        }
    }

    /**
     * Fetch issues from MongoDB issueAnalysis collection where analysis is not yet completed
     */
    private async fetchIssuesFromDB(): Promise<any[]> {
        try {
            const db = getMongoDb();
            const collection = db.collection('issueAnalysis');
            const issues = await collection.find({ 
                $or: [
                    { analysisCompleted: false },
                    { analysisCompleted: { $exists: false } }
                ]
            }).toArray();
            return issues;
        } catch (error) {
            console.error('Error fetching issues from issueAnalysis collection:', error);
            throw error;
        }
    }

    private async fetchIssueFromDB(ticketId: string): Promise<any> {
        try {
            const db = getMongoDb();
            const collection = db.collection('issueAnalysis');
            const issue = await collection.findOne({ ticketId });
            return issue;
        } catch (error) {
            console.error('Error fetching issue from issueAnalysis collection:', error);
            throw error;
        }
    }

    /**
     * Save analysis result back to issueAnalysis collection for a single issue
     */
    private async saveAnalysisResult(analysisResult: AIAnalysisResponse): Promise<void> {
        try {
            const db = getMongoDb();
            const collection = db.collection('issueAnalysis');

            const updateResult = await collection.updateOne(
                { ticketId: analysisResult["Issue ID"] },
                {
                    $set: {
                        analysisResult: analysisResult,
                        analysisCompleted: true,
                        analysisUpdatedAt: new Date()
                    }
                }
            );

            console.log(`Saved analysis result for issue ${analysisResult["Issue ID"]}`);
        } catch (error) {
            console.error('Error saving analysis result to issueAnalysis collection:', error);
            throw error;
        }
    }

    /**
     * Save analysis results back to issueAnalysis collection
     */
    private async saveAnalysisResults(analysisResults: AIAnalysisResponse[]): Promise<void> {
        try {
            const db = getMongoDb();
            const collection = db.collection('issueAnalysis');

            // Update each document with analysis results
            const bulkOps = analysisResults.map((result: AIAnalysisResponse) => ({
                updateOne: {
                    filter: { ticketId: result["Issue ID"] },
                    update: {
                        $set: {
                            analysisResult: result,
                            analysisCompleted: true,
                            analysisUpdatedAt: new Date()
                        }
                    }
                }
            }));

            const updateResult = await collection.bulkWrite(bulkOps);
            console.log(`Saved analysis results for ${updateResult.modifiedCount} issues`);
        } catch (error) {
            console.error('Error saving analysis results to issueAnalysis collection:', error);
            throw error;
        }
    }

    /**
     * Fetch all issues from MongoDB issueAnalysis collection
     */
    private async getAllIssuesFromDB(): Promise<any[]> {
        try {
            const db = getMongoDb();
            const collection = db.collection('issueAnalysis');
            const issues = await collection.find({}).toArray();
            return issues;
        } catch (error) {
            console.error('Error fetching all issues from issueAnalysis collection:', error);
            throw error;
        }
    }

    /**
     * Call the external AI service API
     */
    private async callAIServiceBulk(requestBody: any[]): Promise<any[]> {
        try {
            console.log(`Calling AI service at ${AI_SERVICE_URL}`);

            const response = await fetch(`${AI_SERVICE_URL}/predict-bulk`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`AI Service error ${response.status}: ${errorText}`);
            }

            const result = await response.json() as any;
            console.log('AI service response received');
            return result || [];
        } catch (error) {
            console.error('Error calling AI service:', error);
            throw error;
        }
    }

    private async callAIService(issue: any): Promise<any> {
        try {
            console.log(`Calling AI service at ${AI_SERVICE_URL}`);

            const response = await fetch(`${AI_SERVICE_URL}/predict-issue`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(issue)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`AI Service error ${response.status}: ${errorText}`);
            }

            const result = await response.json() as any;
            console.log('AI service response received for single issue');
            console.log('AI service response:', result);
            return result;
        } catch (error) {
            console.error('Error calling AI service:', error);
            throw error;
        }
    }

    /**
     * Map AI service response to AIAnalysisResponse format
     */
    private mapAIResponseToAnalysis(issueId: string, aiResult: any): AIAnalysisResponse {
        return {
            "Issue ID": issueId,
            issue_link: `https://jira.lge.com/issue/browse/${issueId}`,
            predicted_issue_id: aiResult.predicted_issue_id || '',
            predicted_category: aiResult.predicted_category || 'Unknown',
            likely_cause: aiResult.likely_cause || '',
            suggested_fix: aiResult.suggested_fix || '',
            confidence_score: aiResult.confidence_score || 0,
            similar_issues: aiResult.similar_issues || [],
            explanation: aiResult.explanation || '',
            recommended_fix: aiResult.recommended_fix || '',
        };
    }

    /**
     * Generate sample AI analysis data (placeholder)
     * Replace this with actual AI/ML service integration
     */
    // private generateSampleAnalysis(request: AIAnalysisRequest): AIAnalysisResponse {
    //     return {
    //         "Issue ID": request.issueId,
    //         predicted_issue_id: "QEVENTSIT-135375",
    //         predicted_category: "Unknown",
    //         likely_cause: "Camera UI does not load normally when launching the app for the first time. Supported app component loads before camera UI that's why issue occur",
    //         suggested_fix: "- 원인 :Camera UI does not load normally when launching the app for the first time. Supported app component loads before camera UI that's why issue occur\r\n- 대책 : \r\n- 개선버젼 : \r\n- 유입버젼(SW검증단계부터 입력):",
    //         confidence_score: 0.638,
    //         similar_issues: [
    //             {
    //                 issue_id: "QEVENTSIT-135375",
    //                 likely_cause: "Camera UI does not load normally when launching the app for the first time. Supported app component loads before camera UI that's why issue occur",
    //                 distance: 0.36211577879691426
    //             },
    //             {
    //                 issue_id: "DITTEST-8166",
    //                 likely_cause: "Contents in Camera app is not loading.",
    //                 distance: 0.3788889276319092
    //             },
    //             {
    //                 issue_id: "QEVENTSIT-134209",
    //                 likely_cause: "to stabilize video stream when new device is connected , exiting stream is stopped and it causes this issue",
    //                 distance: 0.4063177704811054
    //             },
    //             {
    //                 issue_id: "DITTEST-7291",
    //                 likely_cause: "Camera screen is not loading in Camera app , beacuse th econfigd is removed in webos26 and need to use systemprofile",
    //                 distance: 0.4161643633940426
    //             },
    //             {
    //                 issue_id: "DITTEST-7860",
    //                 likely_cause: "Multiview app is not available in camera app its because of error in network failure condition",
    //                 distance: 0.4299929994340529
    //             }
    //         ]
    //     };
    // }
}

export const aiAnalysisService = new AIAnalysisService();
