'use strict';

const AWS = require('aws-sdk');
const url = require('url');
const https = require('https');
const querystring = require('querystring');


const encrypted = {
	slackToken: process.env.slackToken,
	slackChannelID: process.env.slackChannelID
};

let decrypted = {};

function postMessage(message, callback) {
      const body = "";

      var alertName = querystring.escape(message.alert_description);

        var attachments = [
            {
                "title": "Event",
                "text": message.recent_hits[0],
                "fallback": "loggly alert",
                "callback_id": message.alert_description,
                "color": "danger",
                "attachment_type": "default",
                "actions": [
                    {
                        "name": "sdp",
                        "text": "Create SDP Ticket...",
                        "type": "select",
                        "options":[
                            {
                                "text": "CSI Support",
                                "value": "CSI Support Team"
                            },
                            {
                                "text": "Infrastructure",
                                "value": "Infrastructure"
                            },
                            {
                                "text": "Help Desk",
                                "value": "Help Desk"
                            }
                            ]
                    },
                    {
                        "name": "acknowledge",
                        "text": "Acknowledge",
                        "type": "button",
                        "value": "acknowledge"
                    }
                ]
            }
        ];
        attachments = JSON.stringify(attachments);
        attachments = querystring.escape(attachments);

        var slackText = "*Alert Name:* " + message.alert_name + "\n *Alert Description:* " + message.alert_description + "\n *When: * From " + message.start_time + " to " + message.end_time + "\n *Loggly Search: *" + message.search_link;
        slackText = querystring.escape(slackText);
        const path = '/api/chat.postMessage?token=' + decrypted.slackToken + '&text=' + slackText + '&channel=' + decrypted.slackChannelID + '&as_user=true&attachments=' + attachments;

		var post_options = {
	      host: 'slack.com',
	      port: '443',
	      path: path,
	      method: 'POST',
	      headers: {
	          'Content-Type': 'application/x-www-form-urlencoded'
	      }
	  };

    const postReq = https.request(post_options, (res) => {
        const chunks = [];
        res.setEncoding('utf8');
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
            if (callback) {
                callback({
                    body: chunks.join(''),
                    statusCode: res.statusCode,
                    statusMessage: res.statusMessage,
                });
            }
        });
        return res;
    });

    postReq.write(body);
    postReq.end();

}

function processEvent(event, callback) {

    postMessage(event, (response) => {
        if (response.statusCode < 400) {
            console.info('Message posted successfully');
            //callback(null);
        } else if (response.statusCode < 500) {
            console.error(`Error posting message to Slack API: ${response.statusCode} - ${response.statusMessage}`);
            callback(null);  // Don't retry because the error is due to a problem with the request
        } else {
            // Let Lambda retry
            callback(`Server error when processing message: ${response.statusCode} - ${response.statusMessage}`);
        }
    });
}

exports.handler = (event, context, callback) => {

	if ( decrypted.slackToken && decrypted.slackChannelID ) {
				processEvent(event);
		} else {
				const kms = new AWS.KMS();

				const decryptPromises = [
						kms.decrypt( { CiphertextBlob: new Buffer(encrypted.slackToken, 'base64') } ).promise(),
						kms.decrypt( { CiphertextBlob: new Buffer(encrypted.slackChannelID, 'base64') } ).promise()
				];

				Promise.all( decryptPromises ).then( data => {
						decrypted.slackToken = data[0].Plaintext.toString('ascii');
						decrypted.slackChannelID = data[1].Plaintext.toString('ascii');

						processEvent(event);
				}).catch( err => {
						console.log('Decrypt error:', err);
						return callback(err);
				});
		}
};
