import { IfcxFile } from "../schema/schema-helper";
import { log } from "../util/log";
import { RemoteLayerProvider } from "./layer-providers";
import { LOCAL_IMPORT_MAP } from "../../local-import-map";

function buildCandidateUrls(uri: string): string[] {
    const candidates: string[] = [];
    const local = LOCAL_IMPORT_MAP[uri];
    if (local) {
        candidates.push(local);
    }
    candidates.push(uri);
    return candidates;
}

export class FetchLayerProvider implements RemoteLayerProvider
{
    layers: Map<string, IfcxFile>;

    constructor()
    {
        this.layers = new Map<string, IfcxFile>();
    }
    
    async FetchJson(url: string) {
        let result = await fetch(url);
        if (!result.ok) {
            return new Error(`Failed to fetch ${url}: ${result.status}`);
        }
        try 
        {
            return await result.json();
        }
        catch(e)
        {
            log(url);
            return new Error(`Failed to parse json at ${url}: ${e}`);
        }
    }

    async GetLayerByURI(uri: string): Promise<IfcxFile | Error> {
        
        if (!this.layers.has(uri))
        {
            for (const candidate of buildCandidateUrls(uri)) {
                const fetched = await this.FetchJson(candidate);
                if (fetched instanceof Error) {
                    log(fetched.toString());
                    continue;
                }
                let file = fetched as IfcxFile;
                this.layers.set(uri, file);
                return file;
            }
            return new Error(`File with id "${uri}" not found`);
        }
        return this.layers.get(uri)!; 
    }
}
