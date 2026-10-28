import Foundation

@MainActor final class CocoAttachmentUpload {
    private var activeSession: URLSession?
    private var files: [String: URL] = [:]
    func clear() { activeSession?.invalidateAndCancel(); activeSession = nil; files.removeAll() }
    func manifest(_ attachment: MacHistoryAttachment) -> [String: Any] {
        var row: [String: Any] = ["guid": attachment.guid,"fileName": attachment.fileName,"mimeType": attachment.mimeType as Any? ?? NSNull(),"byteCount": max(0,attachment.byteCount),"status": attachment.status]
        if let path = attachment.localPath {
            let url = URL(fileURLWithPath: path).resolvingSymlinksInPath()
            if let properties = try? url.resourceValues(forKeys: [.isRegularFileKey,.fileSizeKey]), properties.isRegularFile == true, let size = properties.fileSize {
                row["byteCount"] = size
                if size > 50 * 1024 * 1024 { row["status"] = "too_large" }
                else { let token = UUID().uuidString; files[token] = url; row["token"] = token }
            } else { row["status"] = "unavailable" }
        }
        return row
    }
    func upload(input: [String: Any], current: () -> Bool) async throws -> [String: Any] {
        guard current(), let token = input["token"] as? String, let file = files[token],
              let raw = input["url"] as? String, let destination = URL(string: raw),destination.scheme == "https", destination.host == "kfnsnwqylsdsbgnwgxva.supabase.co",
              destination.path.hasPrefix("/storage/v1/object/upload/sign/crm-private-message-attachments/"),destination.user == nil,destination.password == nil,
              let query = URLComponents(url:destination,resolvingAgainstBaseURL:false)?.queryItems, query.count == 1,query[0].name == "token",query[0].value?.isEmpty == false else { throw CocoNativeError(message: "Attachment upload expired. Recheck history to retry.") }
        let root = URL(fileURLWithPath:NSHomeDirectory()+"/Library/Messages/Attachments").resolvingSymlinksInPath().path + "/"
        let resolved = file.resolvingSymlinksInPath()
        guard resolved.path.hasPrefix(root),let properties = try? resolved.resourceValues(forKeys:[.isRegularFileKey,.fileSizeKey]),properties.isRegularFile == true,let size = properties.fileSize,size<=50*1024*1024 else { throw CocoNativeError(message: "This attachment is unavailable or exceeds 50 MB.") }
        let payload = try Data(contentsOf:resolved,options:.mappedIfSafe)
        guard payload.count == size,current() else { throw CocoNativeError(message: "Attachment changed while importing. Recheck history.") }
        var request = URLRequest(url:destination);request.httpMethod = "PUT";request.timeoutInterval = 60;request.setValue("application/octet-stream",forHTTPHeaderField:"Content-Type")
        let configuration = URLSessionConfiguration.ephemeral;configuration.httpCookieStorage = nil
        let session = URLSession(configuration:configuration,delegate:NoAttachmentRedirect(),delegateQueue:nil)
        activeSession = session
        defer { session.invalidateAndCancel(); activeSession = nil }
        let (_,response) = try await session.upload(for:request,from:payload)
        guard current(),let code = (response as? HTTPURLResponse)?.statusCode,(200...299).contains(code)||code==409 else { throw CocoNativeError(message: "Attachment upload interrupted. Recheck history to retry.") }
        files.removeValue(forKey:token);return ["uploaded":true]
    }
}
private final class NoAttachmentRedirect:NSObject,URLSessionTaskDelegate {
    func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping(URLRequest?)->Void){completionHandler(nil)}
}
