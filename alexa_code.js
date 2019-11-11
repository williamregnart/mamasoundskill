
const Alexa = require('ask-sdk-core');
const http = require('https');

const PERSISTENCY = require('ask-sdk-s3-persistence-adapter');

//URL where events data are taken
const URL = "https://public.opendatasoft.com/api/records/1.0/search/?dataset=evenements-publics-cibul"

var nbList = 0

//var to store events
var events = undefined

// var to store requests data - unused by User
var data = undefined

//return a vector of objects for representing events
function getEventList(records){
    var i
    var result=[]
    for(i in records){
        result.push({
            number:i,
            title:records[i].fields.title,
            adress:records[i].fields.address,
            price:records[i].fields.pricing_info,
            tags:records[i].fields.tags,
            hour:getHoursFromTimetable(records[i].fields.timetable)
        })
    }
    return result
}

//return another format of timetable in parameter
function getHoursFromTimetable(timetable) {
    return timetable.split(";")[0].split(" ").map(fullDate => new Date(fullDate)).map(date => date.getHours() + " heures "+ date.getMinutes())
    // .split(" ").map(fullDate => fullDate.split("T").queue).join(", ")
}

//retrieve all events title
function getNameEvents(records){
    let i
    let result=[]
    for (i in records) {
        result.push(records[i].fields.title);
    }
    return result
}

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    async handle(handlerInput) {
        const response = "Bonjour et bienvenue sur le Mama Sound ! Que puis-je faire pour vous ?";
        return handlerInput.responseBuilder
            .speak(response)
            .reprompt(response)
            .getResponse();
    }
};

//intent handler for getting the city by default
const GetDefaultCityHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
        && Alexa.getIntentName(handlerInput.requestEnvelope) === 'GetDefaultCity';        
    },
    async handle(handlerInput) {
        const attributesManager = handlerInput.attributesManager;
        const s3Attributes = await attributesManager.getPersistentAttributes() || {"userCity":"Paris"};
        const userCity = s3Attributes.hasOwnProperty("userCity")? s3Attributes.userCity : "undefined";
        
        const speechOutput = userCity === "undefined" ? "Vous n'avez pas enregistré de ville par défaut." : `Votre ville enregistrée est ${s3Attributes.userCity}`;
  
        return handlerInput.responseBuilder
         .speak(speechOutput)
         .reprompt()
         .getResponse();
    }
}

//intent handler for retrieving the event the user said
const ChoiceEventIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
        && Alexa.getIntentName(handlerInput.requestEnvelope) === 'ChooseEvent';        
    },
    handle(handlerInput) {
        const choice = handlerInput.requestEnvelope.request.intent.slots.choix.value;
        let numberChoice
        switch(choice){
            case 'premier':
                numberChoice = 1;
                break;
            case 'second':
            case 'deuxième':
            case 'avant dernier':
                numberChoice = 2;
                break;
            case 'troisième':
            case 'dernier':
                numberChoice = 3;
                break;
            default :
                numberChoice = 0
        }
        const eventChosen = events[3*nbList + numberChoice-1]
        const eventTitle = eventChosen.name === "undefined" ? "Le titre de l'évènement n'est pas renseigné. " : "Voici les informations sur l'évènement "+eventChosen.title+". ";
        const eventAdress = eventChosen.adress === "undefined" ? "L'adresse de l'évènement n'est pas renseignée." : "L'évènement a lieu à l'adresse "+eventChosen.adress+". ";
        const eventHour = eventChosen.hour === "undefined" ? "L'heure de début n'est pas renseignée." : "Différents horaires sont disponibles : "+eventChosen.hour.join(", ")+". ";
        const eventPrice = eventChosen.price === "undefined" ? "Pas de tarification renseignée pour cet évènement." : "La tarification pour cet évènement est "+eventChosen.price+". ";

        return handlerInput.responseBuilder
        .speak(eventTitle+eventAdress+eventHour+eventPrice)
        .reprompt()
        .getResponse();
    }
}

//retrieve at more 3 events title, depending on the actual number of events
function giveEvents(){
    let speakOutput = "";
    for(let i=nbList*3;i<(nbList+1)*3;i++){
        if(i<events.length){
            
            speakOutput += events[i].title+".\r\n"
        }
    }
    return speakOutput
}

//intent handler to get next list of events
const GetNextListHandler = {
     canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
        && Alexa.getIntentName(handlerInput.requestEnvelope) === 'NextList';        
    },
    handle(handlerInput) {
        nbList += 1

        var endSpeakOutput = "\r\nChoisissez l'un ou dites \"suivant\" !"

        if (nbList === Math.floor(events.length/3)) {
            endSpeakOutput = "Ce sont les derniers résultats que je peux vous proposer ! Y-en a t-il un parmi ceux là qui vous intéresse ?"
        }

        if (giveEvents().length === 0 ) {
         endSpeakOutput = "Je n'ai pas plus de résultats à vous soumettre. Essayez autre chose ! "   
        }
        return handlerInput.responseBuilder
         .speak(giveEvents()+" "+endSpeakOutput)
         .reprompt()
         .getResponse();
    }
}

//intent handler to get previous list of events
const GetPreviousListHandler = {
     canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
        && Alexa.getIntentName(handlerInput.requestEnvelope) === 'PreviousList';        
    },
    handle(handlerInput) {
        nbList -= 1
        return handlerInput.responseBuilder
         .speak(giveEvents())
         .reprompt()
         .getResponse();
    }
}

//handling request for events in a city at a date
const AskEventCityDateKindIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
        && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AskEventCityDateKind';        
    },
    async handle(handlerInput) {
        
        // retrieving defaut city
        const attributesManager = handlerInput.attributesManager;
        const s3Attributes = await attributesManager.getPersistentAttributes();
        let city = s3Attributes.hasOwnProperty("userCity")? s3Attributes.userCity : "Paris";
        
        const citySlotLowerCase = handlerInput.requestEnvelope.request.intent.slots.ville.value;
        
        //if city has been given by user, we use it, else, it will be city by default
        if(citySlotLowerCase !== undefined){
            city = citySlotLowerCase.charAt(0).toUpperCase() + citySlotLowerCase.slice(1)
        }
        
        const date = handlerInput.requestEnvelope.request.intent.slots.date.value;
        const kindEvent = handlerInput.requestEnvelope.request.intent.slots.type.value;
        
        //complete the URL to find good events
        const URLRequest = URL + "&refine.city="+city+"&refine.date_start="+date+"&q="+kindEvent;
        console.log(URLRequest)
        return new Promise((resolve, reject) => {
            getEvents(URLRequest, '').then(response => {
                data = response
                events = getEventList(data.records)
                let speakOutput = "J'ai trouvé "+events.length+" évènements à "+city+" le "+date+" sur le thème "+kindEvent+".\r\n";
                let endSpeakOutput = "";
                
                if(events.length === 0) {
                    speakOutput = "Je n'ai trouvé aucun évènement qui correspond à votre recherche. \r\n";
                    endSpeakOutput = "Essayez autre chose ! "
                }
        
                if(events.length>3){
                    speakOutput+= "Voici les 3 premiers : "
                    endSpeakOutput = "Si un évènement vous intéresse, dites-moi sa place. Sinon, dites \"suivant\" pour continuer la liste ! ";
                }
                else if(events.length>0){
                    speakOutput+= "Les voici : "
                    endSpeakOutput = "Y a t-il un évènement qui vous intéresse ?"
                }
                speakOutput += giveEvents()
                resolve(handlerInput.responseBuilder
                .addDelegateDirective({
                    name: 'ChooseEvent',
                    confirmationStatus: 'NONE',
                    slots: {}
    })
                    .speak(speakOutput+" "+endSpeakOutput)
                    //.listen(endSpeakOutput)
                    .reprompt("ok")
                    .getResponse());
            }).catch(error => {
                reject(handlerInput.responseBuilder
                    .speak(`I wasn't able to find an event`)
                    .getResponse());
            });
        });
    }
}




const AddDefaultCityHandler = {
  
    // if I asked for a default city
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
                && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AddDefaultCity';
    },
    
    async handle(handlerInput) {
        // reprompt repromptOutput
        const repromptOutput = "Que puis-je faire d'autre pour vous ?"
        //get city slot of user query and capitalize first letter
        const citySlotLowerCase = handlerInput.requestEnvelope.request.intent.slots.city.value;
        const city = citySlotLowerCase.charAt(0).toUpperCase() + citySlotLowerCase.slice(1)
       
       
       // way to store data in persistency
        const attributesManager = handlerInput.attributesManager;
        let s3Attributes = {"userCity":city};
        attributesManager.setPersistentAttributes(s3Attributes);
        await attributesManager.savePersistentAttributes();

        let speechOutput = `Je saurai dorénavant que vous voulez par défaut les évènements de la ville de ${s3Attributes.userCity}.`;
       
       
       return handlerInput.responseBuilder
         .speak(speechOutput+ " "+repromptOutput)
         .reprompt()
         .getResponse();
    }
    
}

//http GET request
const getEvents = function(url, query) {
    return new Promise((resolve, reject) => {
        const request = http.get(`${url}`, response => {
            response.setEncoding('utf8');
           
            let returnData = '';
            if (response.statusCode < 200 || response.statusCode >= 300) {
                return reject(new Error(`${response.statusCode}: ${response.req.getHeader('host')} ${response.req.path}`));
            }
           
            response.on('data', chunk => {
                returnData += chunk;
            });
           
            response.on('end', () => {
                resolve(JSON.parse(returnData));
            });
           
            response.on('error', error => {
                reject(error);
            });
        });
        request.end();
    });
}

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        const speakOutput = 'You can say hello to me! How can I help?';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
                || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
    },
    handle(handlerInput) {
        const speakOutput = 'Goodbye!';
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
    }
};

const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        // Any cleanup logic goes here.
        nbList = 0
        events = undefined
        data = undefined
        return handlerInput.responseBuilder.getResponse();
    }
};

// The intent reflector is used for interaction model testing and debugging.
// It will simply repeat the intent the user said. You can create custom handlers
// for your intents by defining them above, then also adding them to the request
// handler chain below.

const IntentReflectorHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest';
    },
    handle(handlerInput) {
        const intentName = Alexa.getIntentName(handlerInput.requestEnvelope);
        const speakOutput = `Vous avez appelé l'intent ${intentName}`;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
            .getResponse();
    }
};

// Generic error handling to capture any syntax or routing errors. If you receive an error
// stating the request handler chain is not found, you have not implemented a handler for
// the intent being invoked or included it in the skill builder below.
const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        console.log(`~~~~ Error handled: ${error.stack}`);
        const speakOutput = `Je n'ai pas réussi à accéder à votre demande... Essayez encore`;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};



// The SkillBuilder acts as the entry point for your skill, routing all request and response
// payloads to the handlers above. Make sure any new handlers or interceptors you've
// defined are included below. The order matters - they're processed top to bottom.
exports.handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(
        AddDefaultCityHandler,
        GetDefaultCityHandler,
        AskEventCityDateKindIntentHandler,
        ChoiceEventIntentHandler,
        GetNextListHandler,
        GetPreviousListHandler,
        LaunchRequestHandler,
        HelpIntentHandler,
        CancelAndStopIntentHandler,
        SessionEndedRequestHandler,
        IntentReflectorHandler,
    )
    .addErrorHandlers(
        ErrorHandler,
    )
     .withPersistenceAdapter(
         new PERSISTENCY.S3PersistenceAdapter({bucketName:process.env.S3_PERSISTENCE_BUCKET})
     )
    .lambda();
    